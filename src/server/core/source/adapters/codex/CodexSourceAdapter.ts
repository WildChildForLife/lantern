import { FileSystem, Path } from "@effect/platform";
import { Effect, Option } from "effect";
import { ApplicationContext } from "../../../platform/services/ApplicationContext.ts";
import { canonicalizeProjectPath } from "../../functions/canonicalizeProjectPath.ts";
import type { SourceAdapter } from "../../models/SourceAdapter.ts";
import {
  type SourceDetection,
  type SourceProject,
  SourceReadError,
  type SourceSession,
  SourceSessionGoneError,
  type SourceSessionRef,
} from "../../models/SourceEntities.ts";
import { CODEX_SOURCE_ID } from "../../models/SourceId.ts";
import { parseRollout, type RolloutSessionMeta } from "./functions/parseRollout.ts";
import { rolloutSessionId, virtualProjectPath } from "./functions/rolloutPaths.ts";

const SESSION_DIRS = ["sessions", "archived_sessions"] as const;

/**
 * Enough of a rollout to reach `session_meta` and the first `turn_context`,
 * which are the first lines of the file. Reading whole transcripts to group
 * them by workspace would mean reading every byte of a history that runs to
 * gigabytes.
 */
const HEAD_BYTES = 16 * 1024;

/**
 * How long one filesystem scan is reused.
 *
 * A sync calls `listProjects` and then `listSessions` once per project. Without
 * this that is one full walk of the tree per project, and the same file's
 * metadata parsed as many times as there are workspaces. Short enough that a
 * later sync always starts from disk; correctness never rests on it, since a
 * miss just does the walk again.
 */
const SCAN_TTL_MS = 2_000;

type ScannedRollout = {
  readonly filePath: string;
  readonly mtimeMs: number;
  readonly meta: RolloutSessionMeta;
};

/**
 * OpenAI's Codex CLI.
 *
 * Two things make it unlike Claude Code. Its history is partitioned by *date*
 * rather than by project — `sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl` — so
 * a project only exists as the `cwd` recorded inside each transcript. And a
 * session's file therefore cannot be found from a project id by joining paths;
 * it has to be located by walking the trees.
 *
 * Read-only, and not watched: which project a changed file belongs to is inside
 * the file, and classifying a path has to stay a pure function. Codex sessions
 * refresh when a sync runs rather than the moment they change.
 *
 * Codex also keeps a `session_index.jsonl` beside the trees, which would make
 * this listing far cheaper. It is deliberately not read: its schema has not
 * been verified against a real installation, and a listing built on a guessed
 * format fails by *omitting* sessions, which looks exactly like having none.
 */
const makeAdapter = (): SourceAdapter => {
  const rootPath = Effect.gen(function* () {
    const path = yield* Path.Path;
    const context = yield* ApplicationContext;
    const home = yield* context.homeDirectory;
    const codexHome = yield* context.sourceRoot(CODEX_SOURCE_ID);

    return codexHome ?? path.resolve(home ?? "/", ".codex");
  });

  /**
   * The options that decide which working directories count as one workspace.
   *
   * Every call that canonicalises a path has to pass the same ones. Canonicalise
   * without them and `~/work/api` stays literal while the listing expanded it,
   * so a project's own sessions no longer match it and the source reads empty.
   */
  const canonicalizeOptions = Effect.gen(function* () {
    const context = yield* ApplicationContext;
    const home = yield* context.homeDirectory;

    return {
      homeDirectory: home ?? undefined,
      platform: context.platform,
    };
  });

  /** Every rollout file under both trees. */
  const listRolloutFiles = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* rootPath;

    const walk = (directory: string): Effect.Effect<string[], never, FileSystem.FileSystem> =>
      Effect.gen(function* () {
        const names = yield* fs
          .readDirectory(directory)
          .pipe(Effect.catchAll(() => Effect.succeed<string[]>([])));

        const found: string[] = [];
        for (const name of names) {
          const entryPath = path.join(directory, name);
          const stat = yield* fs.stat(entryPath).pipe(Effect.catchAll(() => Effect.succeed(null)));
          if (stat === null) continue;

          if (stat.type === "Directory") {
            found.push(...(yield* walk(entryPath)));
            continue;
          }

          if (name.endsWith(".jsonl") && name.startsWith("rollout-")) {
            found.push(entryPath);
          }
        }

        return found;
      });

    const files: string[] = [];
    for (const directory of SESSION_DIRS) {
      files.push(...(yield* walk(path.join(root, directory))));
    }

    return files.sort();
  });

  /**
   * Reads only as far as the metadata: the working directory and session id are
   * in the first lines, and grouping thousands of sessions must not mean
   * reading every transcript in full.
   *
   * The final line of a `HEAD_BYTES` window is almost always cut mid-JSON, so it
   * is dropped rather than counted as a line that failed to parse.
   */
  const readMeta = (filePath: string) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const head = yield* Effect.scoped(
        Effect.gen(function* () {
          const file = yield* fs.open(filePath, { flag: "r" });
          const buffer = new Uint8Array(HEAD_BYTES);
          const read = yield* file.read(buffer);
          return new TextDecoder().decode(buffer.subarray(0, Number(read)));
        }),
      ).pipe(Effect.catchAll(() => Effect.succeed("")));

      const lines = head.split("\n");
      const complete = head.length < HEAD_BYTES ? lines : lines.slice(0, -1);

      return parseRollout(complete.join("\n"), rolloutSessionId(filePath)).meta;
    });

  /**
   * One walk of both trees with each file's metadata, reused across the calls a
   * single sync makes.
   *
   * A file whose mtime has not moved keeps the metadata already parsed for it,
   * so re-scanning an unchanged history costs stats and no reads at all.
   */
  let lastScan: { root: string; at: number; entries: readonly ScannedRollout[] } | null = null;

  const scan = Effect.gen(function* () {
    const root = yield* rootPath;
    // Keyed by root, not only by time: the adapter is one value for the whole
    // process, and a second Lantern pointed at another history — or a test at a
    // fixture tree — must never be served the first one's scan.
    const cached = lastScan?.root === root ? lastScan : null;
    if (cached !== null && Date.now() - cached.at < SCAN_TTL_MS) {
      return cached.entries;
    }

    const fs = yield* FileSystem.FileSystem;
    const files = yield* listRolloutFiles;
    const previous = new Map(cached?.entries.map((entry) => [entry.filePath, entry]) ?? []);

    const entries: ScannedRollout[] = [];
    for (const filePath of files) {
      const stat = yield* fs.stat(filePath).pipe(Effect.catchAll(() => Effect.succeed(null)));
      if (stat === null) continue;

      const mtimeMs = Option.getOrElse(stat.mtime, () => new Date(0)).getTime();
      const reusable = previous.get(filePath);

      entries.push(
        reusable !== undefined && reusable.mtimeMs === mtimeMs
          ? reusable
          : { filePath, mtimeMs, meta: yield* readMeta(filePath) },
      );
    }

    lastScan = { root, at: Date.now(), entries };
    return entries;
  });

  const listProjects = () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const root = yield* rootPath;
      const options = yield* canonicalizeOptions;
      const scanned = yield* scan;

      const byCanonicalPath = new Map<string, { cwd: string; mtimeMs: number }>();

      for (const { meta, mtimeMs } of scanned) {
        if (meta.cwd === null) continue;

        const canonical = canonicalizeProjectPath(meta.cwd, options);
        if (canonical === null) continue;

        const existing = byCanonicalPath.get(canonical);
        byCanonicalPath.set(canonical, {
          cwd: existing?.cwd ?? meta.cwd,
          mtimeMs: Math.max(existing?.mtimeMs ?? 0, mtimeMs),
        });
      }

      return [...byCanonicalPath.entries()].map(([canonical, { cwd, mtimeMs }]) => ({
        sourceId: CODEX_SOURCE_ID,
        storagePath: virtualProjectPath(path, root, canonical),
        cwd,
        sourceProjectKey: canonical,
        // Codex has no project directory to take a timestamp from, so the most
        // recent session stands in for one.
        dirMtimeMs: mtimeMs,
      })) satisfies SourceProject[];
    });

  const resolveProjectCwd = (project: SourceProject) => Effect.succeed(project.cwd);

  const listSessions = (project: SourceProject) =>
    Effect.gen(function* () {
      const options = yield* canonicalizeOptions;
      const scanned = yield* scan;

      const refs: SourceSessionRef[] = [];
      for (const { filePath, mtimeMs, meta } of scanned) {
        if (canonicalizeProjectPath(meta.cwd, options) !== project.sourceProjectKey) continue;

        refs.push({
          sourceId: CODEX_SOURCE_ID,
          sessionId: rolloutSessionId(filePath),
          projectStoragePath: project.storagePath,
          filePath,
          fileMtimeMs: mtimeMs,
          sourceSessionKey: meta.sessionId ?? rolloutSessionId(filePath),
        });
      }

      return refs;
    });

  const readSession = (ref: SourceSessionRef) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const content = yield* fs.readFileString(ref.filePath).pipe(
        Effect.mapError(
          (cause) =>
            new SourceReadError({
              sourceId: CODEX_SOURCE_ID,
              path: ref.filePath,
              reason: cause.message,
              cause,
            }),
        ),
      );

      const parsed = parseRollout(content, ref.sourceSessionKey);

      if (parsed.parseStats.unparsed > 0) {
        yield* Effect.logWarning(
          `${parsed.parseStats.unparsed} unreadable lines in ${ref.filePath}: ${parsed.unparsedLines.join(" | ")}`,
        );
      }

      return {
        ref,
        entries: parsed.entries,
        messageCount: parsed.messageCount,
        // Token counts live in event_msg payloads Lantern does not read yet, so
        // there is nothing here for cost aggregation to scan. The session is
        // recorded with unknown cost rather than a made-up one.
        usageTexts: [],
        parseStats: parsed.parseStats,
      } satisfies SourceSession;
    });

  const resolveSessionRef = (projectStoragePath: string, sessionId: string) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const root = yield* rootPath;
      const options = yield* canonicalizeOptions;
      const scanned = yield* scan;

      const found = scanned.find((entry) => rolloutSessionId(entry.filePath) === sessionId);
      if (found === undefined) {
        return yield* new SourceSessionGoneError({ sourceId: CODEX_SOURCE_ID, sessionId });
      }

      // The session id alone would open any session under any project id. Codex
      // records the workspace inside the transcript, so the file has to agree
      // that it belongs to the project being asked about.
      const canonical = canonicalizeProjectPath(found.meta.cwd, options);
      if (canonical === null || virtualProjectPath(path, root, canonical) !== projectStoragePath) {
        return yield* new SourceSessionGoneError({ sourceId: CODEX_SOURCE_ID, sessionId });
      }

      return {
        sourceId: CODEX_SOURCE_ID,
        sessionId,
        projectStoragePath,
        filePath: found.filePath,
        fileMtimeMs: found.mtimeMs,
        sourceSessionKey: found.meta.sessionId ?? sessionId,
      } satisfies SourceSessionRef;
    });

  const detect = () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* rootPath;

      const exists = yield* fs.exists(root).pipe(Effect.catchAll(() => Effect.succeed(false)));
      if (!exists) {
        return {
          sourceId: CODEX_SOURCE_ID,
          rootPath: null,
          hasData: false,
          supported: false,
          unsupportedReason: "not-installed",
        } satisfies SourceDetection;
      }

      const files = yield* listRolloutFiles;
      const probePath = files.at(-1);
      if (probePath === undefined) {
        return {
          sourceId: CODEX_SOURCE_ID,
          rootPath: root,
          hasData: false,
          supported: false,
          unsupportedReason: "no-data",
        } satisfies SourceDetection;
      }

      // Parse a real transcript rather than trusting the directory layout: a
      // format that moved has to report itself, not render as blank rows.
      const content = yield* fs
        .readFileString(probePath)
        .pipe(Effect.catchAll(() => Effect.succeed("")));
      const parsed = parseRollout(content, rolloutSessionId(probePath));
      const readable = parsed.entries.length > 0 && parsed.meta.cwd !== null;

      return {
        sourceId: CODEX_SOURCE_ID,
        rootPath: root,
        hasData: true,
        supported: readable,
        unsupportedReason: readable ? null : "unknown-shape",
      } satisfies SourceDetection;
    });

  return {
    id: CODEX_SOURCE_ID,
    displayName: "Codex CLI",
    capabilities: {
      // Which project a changed file belongs to is inside the file, and
      // classifying a path must stay pure.
      watch: false,
      interactive: false,
      deletable: false,
      cost: "unknown",
    },
    detect,
    listProjects,
    resolveProjectCwd,
    listSessions,
    readSession,
    resolveSessionRef,
    // Not watched, but still declared: this is what every resolved Codex path
    // is validated against before it is opened.
    roots: () => rootPath.pipe(Effect.map((root) => [root])),
    classifyChange: () => null,
  };
};

export const codexSourceAdapter = makeAdapter();

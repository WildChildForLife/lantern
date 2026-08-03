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
import { parseRollout } from "./functions/parseRollout.ts";
import { rolloutSessionId, virtualProjectPath } from "./functions/rolloutPaths.ts";

const SESSION_DIRS = ["sessions", "archived_sessions"] as const;

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
 */
const makeAdapter = (): SourceAdapter => {
  const rootPath = Effect.gen(function* () {
    const path = yield* Path.Path;
    const context = yield* ApplicationContext;
    const home = yield* context.homeDirectory;
    const codexHome = yield* context.sourceRoot(CODEX_SOURCE_ID);

    return codexHome ?? path.resolve(home ?? "/", ".codex");
  });

  /** Every rollout file under both trees, newest directories first. */
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
   * parsing every transcript in full.
   */
  const readMeta = (filePath: string) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const content = yield* fs
        .readFileString(filePath)
        .pipe(Effect.catchAll(() => Effect.succeed("")));

      const head = content.split("\n").slice(0, 8).join("\n");
      return parseRollout(head, rolloutSessionId(filePath)).meta;
    });

  const listProjects = () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const context = yield* ApplicationContext;
      const root = yield* rootPath;
      const files = yield* listRolloutFiles;

      const byCanonicalPath = new Map<string, { cwd: string; mtimeMs: number }>();
      const fs = yield* FileSystem.FileSystem;

      for (const filePath of files) {
        const meta = yield* readMeta(filePath);
        if (meta.cwd === null) continue;

        const canonical = canonicalizeProjectPath(meta.cwd, {
          homeDirectory: (yield* context.homeDirectory) ?? undefined,
          platform: context.platform,
        });
        if (canonical === null) continue;

        const stat = yield* fs.stat(filePath).pipe(Effect.catchAll(() => Effect.succeed(null)));
        const mtimeMs =
          stat === null ? 0 : Option.getOrElse(stat.mtime, () => new Date(0)).getTime();

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
      const fs = yield* FileSystem.FileSystem;
      const files = yield* listRolloutFiles;

      const refs: SourceSessionRef[] = [];
      for (const filePath of files) {
        const meta = yield* readMeta(filePath);
        const canonical = canonicalizeProjectPath(meta.cwd);
        if (canonical !== project.sourceProjectKey) continue;

        const stat = yield* fs.stat(filePath).pipe(Effect.catchAll(() => Effect.succeed(null)));
        if (stat === null) continue;

        refs.push({
          sourceId: CODEX_SOURCE_ID,
          sessionId: rolloutSessionId(filePath),
          projectStoragePath: project.storagePath,
          filePath,
          fileMtimeMs: Option.getOrElse(stat.mtime, () => new Date(0)).getTime(),
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
      const fs = yield* FileSystem.FileSystem;
      const files = yield* listRolloutFiles;

      const filePath = files.find((candidate) => rolloutSessionId(candidate) === sessionId);
      if (filePath === undefined) {
        return yield* new SourceSessionGoneError({ sourceId: CODEX_SOURCE_ID, sessionId });
      }

      const stat = yield* fs.stat(filePath).pipe(Effect.catchAll(() => Effect.succeed(null)));
      if (stat === null) {
        return yield* new SourceSessionGoneError({ sourceId: CODEX_SOURCE_ID, sessionId });
      }

      const meta = yield* readMeta(filePath);

      return {
        sourceId: CODEX_SOURCE_ID,
        sessionId,
        projectStoragePath,
        filePath,
        fileMtimeMs: Option.getOrElse(stat.mtime, () => new Date(0)).getTime(),
        sourceSessionKey: meta.sessionId ?? sessionId,
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
    watchRoots: () => Effect.succeed([]),
    classifyChange: () => null,
  };
};

export const codexSourceAdapter = makeAdapter();

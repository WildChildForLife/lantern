import { FileSystem, Path } from "@effect/platform";
import { Clock, Effect, Option } from "effect";
import { z } from "zod";
import { ApplicationContext } from "../../../platform/services/ApplicationContext.ts";
import { canonicalizeProjectPath } from "../../functions/canonicalizeProjectPath.ts";
import { resolveOnPath } from "../../functions/resolveOnPath.ts";
import { virtualProjectPath } from "../../functions/virtualProjectPath.ts";
import type { HeadlessAnswer, SourceAdapter } from "../../models/SourceAdapter.ts";
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
import { rolloutSessionId } from "./functions/rolloutPaths.ts";

const codexEventSchema = z.looseObject({
  type: z.string(),
  item: z.looseObject({ type: z.string(), text: z.string().optional() }).optional(),
});

const SESSION_DIRS = ["sessions", "archived_sessions"] as const;

/**
 * Enough of a rollout to reach `session_meta` and the first `turn_context`,
 * which are its opening lines. Reading whole transcripts only to group them by
 * workspace would mean reading every byte of a history that runs to gigabytes.
 */
const HEAD_BYTES = 16 * 1024;

/**
 * Where growing the window stops.
 *
 * A `session_meta` larger than this is not a big line, it is a file that is not
 * a rollout. Stopping bounds what one unreadable file can cost, and the session
 * is reported as unreadable rather than read at any price.
 */
const MAX_HEAD_BYTES = 1024 * 1024;

/** Metadata is in the opening lines; parsing further buys nothing. */
const META_LINES = 8;

/**
 * How many rollouts' metadata is kept.
 *
 * A bound rather than a policy: the cache exists so a sync does not re-read
 * files it has already read. Eviction is least-recently-used, which matters
 * more than the number — evicting in insertion order would, for a history past
 * the limit, throw away exactly what the next pass reads first.
 */
const META_CACHE_LIMIT = 20_000;

type RolloutFile = {
  readonly filePath: string;
  readonly mtimeMs: number;
};

type ScannedRollout = RolloutFile & {
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

/**
 * Codex `exec --json` emits one event per line. The answer is the last
 * `agent_message`; everything else is the banner, the model's reasoning and a
 * usage summary, which would otherwise be handed back as though it were the
 * reply.
 */
const parseCodexEvents = (stdout: string): HeadlessAnswer => {
  let text = "";

  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;

    const parsed = codexEventSchema.safeParse(
      ((): unknown => {
        try {
          return JSON.parse(line);
        } catch {
          return undefined;
        }
      })(),
    );
    if (!parsed.success) continue;

    if (parsed.data.item?.type === "agent_message" && parsed.data.item.text !== undefined) {
      text = parsed.data.item.text;
    }
  }

  // Codex reports tokens rather than money, and pricing them would mean
  // knowing a rate for a model the user chose. Nothing is invented.
  return { text, costUsd: 0 };
};

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

  /**
   * Every rollout file under both trees, with the modification time the walk
   * already had to read to tell a file from a directory. Returning it means the
   * caller does not stat the whole history a second time.
   */
  const listRolloutFiles = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* rootPath;

    const walk = (directory: string): Effect.Effect<RolloutFile[], never, FileSystem.FileSystem> =>
      Effect.gen(function* () {
        const names = yield* fs
          .readDirectory(directory)
          .pipe(Effect.catchAll(() => Effect.succeed<string[]>([])));

        const found: RolloutFile[] = [];
        for (const name of names) {
          const entryPath = path.join(directory, name);
          const stat = yield* fs.stat(entryPath).pipe(Effect.catchAll(() => Effect.succeed(null)));
          if (stat === null) continue;

          if (stat.type === "Directory") {
            found.push(...(yield* walk(entryPath)));
            continue;
          }

          if (name.endsWith(".jsonl") && name.startsWith("rollout-")) {
            found.push({
              filePath: entryPath,
              mtimeMs: Option.getOrElse(stat.mtime, () => new Date(0)).getTime(),
            });
          }
        }

        return found;
      });

    const files: RolloutFile[] = [];
    for (const directory of SESSION_DIRS) {
      files.push(...(yield* walk(path.join(root, directory))));
    }

    return files.sort((a, b) => (a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0));
  });

  /**
   * The opening lines of a file, reading as little as will yield a whole one.
   *
   * A window is only useful if it ends on a line boundary, and `session_meta`
   * can be bigger than any window worth starting with — Codex records the
   * assembled instructions in it. So the window grows until it holds a newline
   * rather than falling back to reading the file, which for a rollout running
   * to hundreds of megabytes would cost more than the listing it serves.
   *
   * `read` may return fewer bytes than asked for, so each pass reads until its
   * chunk is full or the file ends.
   */
  const readHead = (filePath: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const file = yield* fs.open(filePath, { flag: "r" });

        const chunks: Uint8Array[] = [];
        let total = 0;
        let atEnd = false;
        let sawNewline = false;

        while (!sawNewline && !atEnd && total < MAX_HEAD_BYTES) {
          const buffer = new Uint8Array(HEAD_BYTES);
          let filled = 0;
          while (filled < HEAD_BYTES) {
            const read = Number(yield* file.read(buffer.subarray(filled)));
            if (read === 0) {
              atEnd = true;
              break;
            }
            filled += read;
          }

          chunks.push(buffer.subarray(0, filled));
          total += filled;
          sawNewline = buffer.subarray(0, filled).includes(0x0a);
        }

        const joined = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          joined.set(chunk, offset);
          offset += chunk.length;
        }

        return { text: new TextDecoder().decode(joined), atEnd };
      }),
    ).pipe(Effect.catchAll(() => Effect.succeed(null)));

  /**
   * Reads only as far as the metadata: the working directory and session id are
   * in the opening lines, and grouping thousands of sessions must not mean
   * reading every transcript in full.
   *
   * Null means the file could not be read, which is not the same as a file with
   * nothing in it — a session that momentarily failed to open must not be
   * remembered as one without a workspace, because the mtime that would
   * invalidate that memory never moves again once the session is archived.
   */
  const readMeta = (filePath: string) =>
    Effect.gen(function* () {
      const head = yield* readHead(filePath);
      if (head === null) {
        return null;
      }

      const lines = head.text.split("\n");
      // A window that stopped before the end of the file cuts its last line
      // mid-JSON, so that line is dropped rather than counted as one that
      // failed to parse. A file that ended inside the window has no such line.
      const complete = head.atEnd ? lines : lines.slice(0, -1);

      return parseRollout(complete.slice(0, META_LINES).join("\n"), rolloutSessionId(filePath))
        .meta;
    });

  /**
   * Metadata already parsed for a rollout, keyed by the file it came from.
   *
   * Deliberately not a snapshot with a lifetime. Every listing walks the trees
   * afresh, so no two calls disagree about which files exist; what is reused is
   * only a file's own metadata, and only while its mtime says the file has not
   * changed. That makes reuse correct by construction rather than by timing,
   * and leaves a concurrent second reader costing duplicated work rather than a
   * different answer.
   */
  const metaCache = new Map<string, { mtimeMs: number; meta: RolloutSessionMeta }>();

  const rememberMeta = (filePath: string, mtimeMs: number, meta: RolloutSessionMeta) => {
    if (metaCache.size >= META_CACHE_LIMIT) {
      const oldest = metaCache.keys().next();
      if (oldest.done !== true) {
        metaCache.delete(oldest.value);
      }
    }
    metaCache.set(filePath, { mtimeMs, meta });
  };

  /**
   * A file's metadata, from the cache when its mtime says nothing has changed.
   *
   * A hit re-inserts the entry so it becomes the most recently used. Without
   * that the eviction order is insertion order, and since a scan walks files in
   * a stable order, every scan of a history past the limit would evict exactly
   * what the next scan asks for first — taking the hit rate from complete to
   * nothing at the moment the limit is crossed, rather than degrading.
   */
  const metaFor = (filePath: string, mtimeMs: number) =>
    Effect.gen(function* () {
      const cached = metaCache.get(filePath);
      if (cached !== undefined && cached.mtimeMs === mtimeMs) {
        metaCache.delete(filePath);
        metaCache.set(filePath, cached);
        return cached.meta;
      }

      const meta = yield* readMeta(filePath);
      // A file that could not be read this time is retried on the next listing
      // rather than remembered as unreadable: an archived rollout's mtime never
      // moves again, so a cached failure would be permanent.
      if (meta === null) return null;

      rememberMeta(filePath, mtimeMs, meta);
      return meta;
    });

  /**
   * A scan is repeated within one sync — `listProjects` runs it, then
   * `listSessions` runs it again per project — and each pass walks both trees.
   * Holding the result briefly collapses that to one walk without hiding a
   * rollout that appears while the server runs: the window is shorter than the
   * interval between syncs, so the next tick sees it.
   *
   * Keyed by root, because tests point two layers at different fixture
   * directories inside one process and must not share an answer. The per-file
   * metadata cache above is a different thing: it survives longer, because a
   * rollout's opening line never changes once written.
   */
  const SCAN_TTL_MS = 2_000;
  const scanCache = new Map<string, { atMs: number; value: readonly ScannedRollout[] }>();

  /** Every rollout under both trees, with the metadata needed to group it. */
  const scan = Effect.gen(function* () {
    const root = yield* rootPath;

    const cached = scanCache.get(root);
    // Effect's clock rather than Date.now(), so a test can drive the window
    // with TestClock instead of waiting on wall time.
    const now = yield* Clock.currentTimeMillis;
    if (cached !== undefined && now - cached.atMs < SCAN_TTL_MS) {
      return cached.value;
    }

    const files = yield* listRolloutFiles;

    const entries: ScannedRollout[] = [];
    for (const { filePath, mtimeMs } of files) {
      const meta = yield* metaFor(filePath, mtimeMs);
      if (meta === null) continue;

      entries.push({ filePath, mtimeMs, meta });
    }

    scanCache.set(root, { atMs: now, value: entries });
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

      // Only the matched file's metadata is read, and from the cache when the
      // listing already read it. Locating a session still has to walk the trees
      // — a date-partitioned history offers no other way to find one file — but
      // it must not read them.
      const files = yield* listRolloutFiles;
      const found = files.find((candidate) => rolloutSessionId(candidate.filePath) === sessionId);
      if (found === undefined) {
        return yield* new SourceSessionGoneError({ sourceId: CODEX_SOURCE_ID, sessionId });
      }

      const { filePath, mtimeMs } = found;
      const meta = yield* metaFor(filePath, mtimeMs);
      if (meta === null) {
        return yield* new SourceSessionGoneError({ sourceId: CODEX_SOURCE_ID, sessionId });
      }

      // The session id alone would open any session under any project id. Codex
      // records the workspace inside the transcript, so the file has to agree
      // that it belongs to the project being asked about.
      const canonical = canonicalizeProjectPath(meta.cwd, options);
      if (canonical === null || virtualProjectPath(path, root, canonical) !== projectStoragePath) {
        return yield* new SourceSessionGoneError({ sourceId: CODEX_SOURCE_ID, sessionId });
      }

      return {
        sourceId: CODEX_SOURCE_ID,
        sessionId,
        projectStoragePath,
        filePath,
        fileMtimeMs: mtimeMs,
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
      const probePath = files.at(-1)?.filePath;
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
    headless: {
      executable: () => resolveOnPath(CODEX_SOURCE_ID, "codex"),
      // `exec` is the non-interactive mode. The repo check is skipped because
      // Lantern asks about conversations, not about the directory it runs in,
      // and a prompt would block forever with no terminal attached. `--json`
      // because the plain output interleaves a banner, the model's reasoning
      // and a token count with the answer, and no caller can separate them.
      args: (prompt) => ["exec", "--json", "--skip-git-repo-check", prompt],
      parse: parseCodexEvents,
    },
  };
};

export const codexSourceAdapter = makeAdapter();

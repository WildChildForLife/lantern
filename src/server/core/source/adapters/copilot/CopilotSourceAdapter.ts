import { FileSystem, Path } from "@effect/platform";
import { Effect, Option } from "effect";
import { ApplicationContext } from "../../../platform/services/ApplicationContext.ts";
import { canonicalizeProjectPath } from "../../functions/canonicalizeProjectPath.ts";
import { resolveOnPath } from "../../functions/resolveOnPath.ts";
import { virtualProjectPath } from "../../functions/virtualProjectPath.ts";
import type { SourceAdapter } from "../../models/SourceAdapter.ts";
import {
  type SourceDetection,
  type SourceProject,
  SourceReadError,
  type SourceSession,
  SourceSessionGoneError,
  type SourceSessionRef,
} from "../../models/SourceEntities.ts";
import { COPILOT_SOURCE_ID } from "../../models/SourceId.ts";
import { type CopilotMeta, parseEvents, parseMeta } from "./functions/parseEvents.ts";

/**
 * `~/.copilot`, laid out as:
 *
 *   session-state/<sessionID>/events.jsonl   the transcript
 *   session-state/<sessionID>/session.db     per-session checkpoint state
 *   session-store.db                         an index of every session
 *
 * Only `events.jsonl` is read. The two databases hold a derived view — turns,
 * checkpoints, a search index — of what the event log already says, and reading
 * SQLite is a different storage mode rather than another dialect.
 */
const SESSION_DIR = "session-state";
const EVENTS_FILE = "events.jsonl";

/** `session.start` is the first line and a few hundred bytes. */
const HEAD_BYTES = 8 * 1024;

/**
 * GitHub Copilot CLI.
 *
 * Read-only, and watched: each session is a directory whose path names it, so a
 * pure function can classify a change.
 *
 * Like Codex, it files every session in one flat directory and records the
 * working directory inside the transcript, so projects are grouped by the `cwd`
 * on each session's opening event and given a virtual path.
 *
 * Tokens are taken as reported. Cost is not: Copilot bills in premium requests
 * rather than currency, and under BYOK the user pays a provider Lantern has no
 * price table for. Neither converts into a number worth showing.
 */
const makeAdapter = (): SourceAdapter => {
  const rootPath = Effect.gen(function* () {
    const path = yield* Path.Path;
    const context = yield* ApplicationContext;
    const configured = yield* context.sourceRoot(COPILOT_SOURCE_ID);
    if (configured !== undefined) {
      return configured;
    }

    const home = yield* context.homeDirectory;
    return path.resolve(home ?? "/", ".copilot");
  });

  const canonicalizeOptions = Effect.gen(function* () {
    const context = yield* ApplicationContext;
    const home = yield* context.homeDirectory;

    return {
      homeDirectory: home ?? undefined,
      platform: context.platform,
    };
  });

  const readHead = (filePath: string) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const file = yield* fs
        .open(filePath, { flag: "r" })
        .pipe(Effect.catchAll(() => Effect.succeed(null)));
      if (file === null) return null;

      const buffer = new Uint8Array(HEAD_BYTES);
      const read = yield* file.read(buffer).pipe(Effect.catchAll(() => Effect.succeed(BigInt(0))));

      return new TextDecoder().decode(buffer.subarray(0, Number(read)));
    }).pipe(Effect.scoped);

  /**
   * Every session on disk with the identity from its opening event.
   *
   * Not memoised: a session directory appears whenever the CLI is run, and a
   * cached listing would hide it until a restart. Each entry costs one small
   * read rather than a parse of the whole transcript.
   */
  const scan = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* rootPath;

    const sessionRoot = path.join(root, SESSION_DIR);
    const names = yield* fs
      .readDirectory(sessionRoot)
      .pipe(Effect.catchAll(() => Effect.succeed<string[]>([])));

    const found: Array<{ filePath: string; mtimeMs: number; meta: CopilotMeta; id: string }> = [];

    for (const name of names.sort()) {
      const filePath = path.join(sessionRoot, name, EVENTS_FILE);
      const stat = yield* fs.stat(filePath).pipe(Effect.catchAll(() => Effect.succeed(null)));
      if (stat === null) continue;

      const head = yield* readHead(filePath);
      if (head === null) continue;

      found.push({
        filePath,
        mtimeMs: Option.getOrElse(stat.mtime, () => new Date(0)).getTime(),
        meta: parseMeta(head),
        id: name,
      });
    }

    return found;
  });

  const listProjects = () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const root = yield* rootPath;
      const options = yield* canonicalizeOptions;

      const byCanonicalPath = new Map<string, { cwd: string; mtimeMs: number }>();

      for (const { meta, mtimeMs } of yield* scan) {
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
        sourceId: COPILOT_SOURCE_ID,
        storagePath: virtualProjectPath(path, root, canonical),
        cwd,
        sourceProjectKey: canonical,
        // No project directory to take a timestamp from, so the most recent
        // session stands in for one.
        dirMtimeMs: mtimeMs,
      })) satisfies SourceProject[];
    });

  const resolveProjectCwd = (project: SourceProject) => Effect.succeed(project.cwd);

  const listSessions = (project: SourceProject) =>
    Effect.gen(function* () {
      const options = yield* canonicalizeOptions;

      const refs: SourceSessionRef[] = [];
      for (const { filePath, mtimeMs, meta, id } of yield* scan) {
        if (canonicalizeProjectPath(meta.cwd, options) !== project.sourceProjectKey) continue;

        refs.push({
          sourceId: COPILOT_SOURCE_ID,
          // The directory is named for the session, and the opening event says
          // the same thing; the directory name is the one that survives a log
          // that was truncated before it was written.
          sessionId: id,
          projectStoragePath: project.storagePath,
          filePath,
          fileMtimeMs: mtimeMs,
          sourceSessionKey: meta.sessionId ?? id,
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
              sourceId: COPILOT_SOURCE_ID,
              path: ref.filePath,
              reason: cause.message,
              cause,
            }),
        ),
      );

      const parsed = parseEvents(content, ref.sourceSessionKey);

      if (parsed.parseStats.unparsed > 0) {
        yield* Effect.logWarning(
          `${parsed.parseStats.unparsed} unreadable lines in ${ref.filePath}: ${parsed.unparsedLines.join(", ")}`,
        );
      }

      return {
        ref,
        entries: parsed.entries,
        messageCount: parsed.messageCount,
        // Nothing to scan: Copilot writes its own token counts at shutdown.
        usageTexts: [],
        reportedUsage: parsed.usage,
        parseStats: parsed.parseStats,
      } satisfies SourceSession;
    });

  const resolveSessionRef = (projectStoragePath: string, sessionId: string) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* rootPath;
      const options = yield* canonicalizeOptions;

      const filePath = path.join(root, SESSION_DIR, sessionId, EVENTS_FILE);
      const stat = yield* fs.stat(filePath).pipe(Effect.catchAll(() => Effect.succeed(null)));
      if (stat === null) {
        return yield* new SourceSessionGoneError({ sourceId: COPILOT_SOURCE_ID, sessionId });
      }

      // The session's own log says which workspace it belongs to. A session
      // that does not belong to the project asked for is not this project's to
      // return, however readable its file is.
      const head = yield* readHead(filePath);
      const meta = head === null ? null : parseMeta(head);
      const canonical =
        meta === null || meta.cwd === null ? null : canonicalizeProjectPath(meta.cwd, options);

      if (canonical === null || virtualProjectPath(path, root, canonical) !== projectStoragePath) {
        return yield* new SourceSessionGoneError({ sourceId: COPILOT_SOURCE_ID, sessionId });
      }

      return {
        sourceId: COPILOT_SOURCE_ID,
        sessionId,
        projectStoragePath,
        filePath,
        fileMtimeMs: Option.getOrElse(stat.mtime, () => new Date(0)).getTime(),
        sourceSessionKey: meta?.sessionId ?? sessionId,
      } satisfies SourceSessionRef;
    });

  const detect = () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* rootPath;

      const exists = yield* fs.exists(root).pipe(Effect.catchAll(() => Effect.succeed(false)));
      if (!exists) {
        return {
          sourceId: COPILOT_SOURCE_ID,
          rootPath: null,
          hasData: false,
          supported: false,
          unsupportedReason: "not-installed",
        } satisfies SourceDetection;
      }

      const scanned = yield* scan;
      if (scanned.length === 0) {
        return {
          sourceId: COPILOT_SOURCE_ID,
          rootPath: root,
          hasData: false,
          supported: false,
          unsupportedReason: "no-data",
        } satisfies SourceDetection;
      }

      // Read real sessions rather than trusting the layout, and require one to
      // have produced something. "Parsed without complaint" is not the test: a
      // schema that expects a field the format no longer has parses every event
      // happily and yields an empty conversation, which is precisely how a
      // whole history renders blank while looking like it worked.
      //
      // Bounded on purpose. This runs on every settings render, and scanning
      // every transcript on an install whose format has moved is the one case
      // where the cost would be unbounded.
      for (const { filePath, id } of scanned.slice(0, DETECT_SAMPLE)) {
        const content = yield* fs
          .readFileString(filePath)
          .pipe(Effect.catchAll(() => Effect.succeed(null)));
        if (content === null) continue;

        const parsed = parseEvents(content, id);
        if (parsed.entries.length > 0 && parsed.parseStats.unparsed === 0) {
          return {
            sourceId: COPILOT_SOURCE_ID,
            rootPath: root,
            hasData: true,
            supported: true,
            unsupportedReason: null,
          } satisfies SourceDetection;
        }
      }

      return {
        sourceId: COPILOT_SOURCE_ID,
        rootPath: root,
        hasData: true,
        supported: false,
        unsupportedReason: "unknown-shape",
      } satisfies SourceDetection;
    });

  /**
   * Pure: a changed path under `session-state/<sessionID>/events.jsonl` names
   * the session, but not the workspace it belongs to — that is inside the file.
   * The generic sync resolves the project, so the session id is enough.
   */
  const classifyChange = (absolutePath: string, roots: readonly string[]) => {
    const root = roots.find((candidate) => absolutePath.startsWith(`${candidate}/`));
    if (root === undefined) return null;

    const relative = absolutePath.slice(root.length + 1).split("/");
    if (relative.length !== 3) return null;

    const [sessions, sessionId, fileName] = relative;
    if (sessions !== SESSION_DIR || sessionId === undefined || fileName !== EVENTS_FILE) {
      return null;
    }

    return {
      sourceId: COPILOT_SOURCE_ID,
      projectStoragePath: `${root}/${SESSION_DIR}/${sessionId}`,
      sessionId,
      agentId: null,
    };
  };

  return {
    id: COPILOT_SOURCE_ID,
    displayName: "GitHub Copilot CLI",
    capabilities: {
      watch: true,
      interactive: false,
      deletable: false,
      // Tokens are recorded, prices are not — see the note on the adapter.
      cost: "unknown",
    },
    detect,
    listProjects,
    resolveProjectCwd,
    listSessions,
    readSession,
    resolveSessionRef,
    roots: () => rootPath.pipe(Effect.map((root) => [root])),
    classifyChange,
    headless: {
      executable: () => resolveOnPath(COPILOT_SOURCE_ID, "copilot"),
      // `-p` is one non-interactive prompt; `--allow-all-tools` stops it
      // blocking on an approval it has no terminal to receive.
      args: (prompt) => ["-p", prompt, "--allow-all-tools"],
      // Copilot prints the reply as prose and reports no cost on this path.
      parse: (stdout) => ({ text: stdout, costUsd: 0 }),
    },
  };
};

/**
 * How many sessions `detect` will read before giving up.
 *
 * More than one, because an aborted session leaves a log with no conversation
 * in it and reading only the first would report a healthy install as broken.
 * Bounded, because the failing case must not cost a full scan of the history.
 */
const DETECT_SAMPLE = 5;

export const copilotSourceAdapter = makeAdapter();

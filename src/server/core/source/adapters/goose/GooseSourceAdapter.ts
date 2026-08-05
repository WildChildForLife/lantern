import { FileSystem, Path } from "@effect/platform";
import { Effect } from "effect";
import { ApplicationContext } from "../../../platform/services/ApplicationContext.ts";
import { canonicalizeProjectPath } from "../../functions/canonicalizeProjectPath.ts";
import { hasTables, withReadOnlyDatabase } from "../../functions/readOnlySqlite.ts";
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
import { GOOSE_SOURCE_ID } from "../../models/SourceId.ts";
import { parseMessages } from "./functions/parseMessages.ts";
import {
  type GooseSessionRow,
  readMessages,
  readSessions,
  REQUIRED_TABLES,
} from "./functions/readSqlite.ts";

/**
 * `<data>/goose`, whose history is one database:
 *
 *   sessions/sessions.db    every session and every message
 *
 * goose has kept sessions here since 1.10 — there is no file layout to fall
 * back to, so unlike opencode this adapter has only one storage mode.
 */
const DATABASE_PATH = ["sessions", "sessions.db"] as const;

/**
 * How many sessions `detect` reads before giving up.
 *
 * More than one, because an abandoned session holds no conversation and
 * reading only the first would report a healthy install as broken. Bounded,
 * because this runs on every settings render and an install whose schema has
 * moved must not cost a full read of the history.
 */
const DETECT_SAMPLE = 5;

/** A session row with the identities Lantern files it under. */
type LocatedSession = {
  readonly row: GooseSessionRow;
  readonly canonical: string;
  readonly storagePath: string;
  readonly filePath: string;
};

/**
 * goose.
 *
 * Read-only, and polled rather than watched: everything lives in one database,
 * so a changed path names no session and there is nothing a pure function could
 * classify. Codex, Copilot CLI and opencode's database mode make the same call.
 *
 * Tokens are taken as reported. Cost is only claimed when goose recorded one —
 * against a local provider it records none, and a zero there would read as a
 * session that was free rather than one that was never priced.
 */
const makeAdapter = (): SourceAdapter => {
  const rootPath = Effect.gen(function* () {
    const path = yield* Path.Path;
    const context = yield* ApplicationContext;
    const configured = yield* context.sourceRoot(GOOSE_SOURCE_ID);
    if (configured !== undefined) {
      return configured;
    }

    const home = yield* context.homeDirectory;
    // The XDG default, which is where goose puts it itself.
    return path.resolve(home ?? "/", ".local", "share", "goose");
  });

  const databasePath = Effect.gen(function* () {
    const path = yield* Path.Path;
    return path.join(yield* rootPath, ...DATABASE_PATH);
  });

  const canonicalizeOptions = Effect.gen(function* () {
    const context = yield* ApplicationContext;
    const home = yield* context.homeDirectory;

    return {
      homeDirectory: home ?? undefined,
      platform: context.platform,
    };
  });

  const withDatabase = <A>(
    use: (
      database: Parameters<Parameters<typeof withReadOnlyDatabase>[1]>[0],
    ) => Effect.Effect<A, never>,
  ) =>
    databasePath.pipe(
      Effect.flatMap((file) => withReadOnlyDatabase(file, use)),
      Effect.mapError(
        (cause) =>
          new SourceReadError({
            sourceId: GOOSE_SOURCE_ID,
            path: cause.path,
            reason: cause.detail,
            cause,
          }),
      ),
    );

  /**
   * Every session, with a workspace and a path minted for it.
   *
   * A failure propagates rather than becoming an empty list: upstream reads an
   * empty listing as "this source has nothing left" and deletes the cached rows
   * for it, so a locked database must not look like an emptied one.
   */
  const sessions = Effect.gen(function* () {
    const path = yield* Path.Path;
    const root = yield* rootPath;
    const options = yield* canonicalizeOptions;

    const rows = yield* databasePath.pipe(
      Effect.flatMap((file) => withReadOnlyDatabase(file, readSessions)),
      Effect.mapError(
        (cause) =>
          new SourceReadError({
            sourceId: GOOSE_SOURCE_ID,
            path: cause.path,
            reason: cause.detail,
            cause,
          }),
      ),
    );

    return rows.flatMap((row) => {
      if (row.workingDir === null || row.workingDir === "") return [];

      const canonical = canonicalizeProjectPath(row.workingDir, options);
      if (canonical === null) return [];

      return [
        {
          row,
          canonical,
          storagePath: virtualProjectPath(path, root, canonical),
          // Unique per session and under a root, which is all it has to be:
          // nothing opens this path, because the rows live in the database.
          filePath: path.join(root, "#sessions", row.id),
        } satisfies LocatedSession,
      ];
    });
  });

  const listProjects = () =>
    Effect.gen(function* () {
      const byCanonical = new Map<string, { cwd: string; storagePath: string; mtimeMs: number }>();

      for (const { row, canonical, storagePath } of yield* sessions) {
        const existing = byCanonical.get(canonical);
        byCanonical.set(canonical, {
          cwd: existing?.cwd ?? row.workingDir ?? "",
          storagePath,
          // No project directory to take a timestamp from, so the most recently
          // touched session stands in for one.
          mtimeMs: Math.max(existing?.mtimeMs ?? 0, row.updatedMs),
        });
      }

      return [...byCanonical.entries()].map(([canonical, found]) => ({
        sourceId: GOOSE_SOURCE_ID,
        storagePath: found.storagePath,
        cwd: found.cwd,
        sourceProjectKey: canonical,
        dirMtimeMs: found.mtimeMs,
      })) satisfies SourceProject[];
    });

  const resolveProjectCwd = (project: SourceProject) => Effect.succeed(project.cwd);

  const listSessions = (project: SourceProject) =>
    sessions.pipe(
      Effect.map(
        (found) =>
          found
            .filter((candidate) => candidate.canonical === project.sourceProjectKey)
            .map((candidate) => ({
              sourceId: GOOSE_SOURCE_ID,
              sessionId: candidate.row.id,
              projectStoragePath: project.storagePath,
              filePath: candidate.filePath,
              fileMtimeMs: candidate.row.updatedMs,
              sourceSessionKey: candidate.row.id,
            })) satisfies SourceSessionRef[],
      ),
    );

  const readOne = (found: LocatedSession) =>
    Effect.gen(function* () {
      const rows = yield* withDatabase((database) =>
        readMessages(database, found.row.id).pipe(Effect.orElseSucceed(() => [])),
      );

      return parseMessages(rows, {
        sessionKey: found.row.id,
        cwd: found.row.workingDir ?? "",
        model: found.row.modelName ?? "unknown",
      });
    });

  const readSession = (ref: SourceSessionRef) =>
    Effect.gen(function* () {
      const found = (yield* sessions).find(
        (candidate) => candidate.row.id === ref.sourceSessionKey,
      );
      if (found === undefined) {
        return yield* new SourceReadError({
          sourceId: GOOSE_SOURCE_ID,
          path: ref.filePath,
          reason: "session is not in the database",
        });
      }

      const parsed = yield* readOne(found);

      if (parsed.parseStats.unparsed > 0) {
        yield* Effect.logWarning(
          `${parsed.parseStats.unparsed} unreadable messages in goose session ${found.row.id}: ${parsed.unparsedMessages.join(", ")}`,
        );
      }

      return {
        ref,
        entries: parsed.entries,
        messageCount: parsed.messageCount,
        // Nothing to scan: the session row totals its own usage.
        usageTexts: [],
        reportedUsage: {
          costUsd: found.row.costUsd,
          inputTokens: found.row.inputTokens,
          outputTokens: found.row.outputTokens,
          cacheReadTokens: found.row.cacheReadTokens,
          cacheCreationTokens: found.row.cacheWriteTokens,
          modelName: found.row.modelName,
        },
        parseStats: parsed.parseStats,
      } satisfies SourceSession;
    });

  const resolveSessionRef = (projectStoragePath: string, sessionId: string) =>
    Effect.gen(function* () {
      // A read failure is not the same as a session that is gone: reporting it
      // as gone would have upstream delete the cached row for a database that
      // was merely locked.
      const found = (yield* sessions).find(
        (candidate) =>
          candidate.row.id === sessionId && candidate.storagePath === projectStoragePath,
      );
      if (found === undefined) {
        return yield* new SourceSessionGoneError({ sourceId: GOOSE_SOURCE_ID, sessionId });
      }

      return {
        sourceId: GOOSE_SOURCE_ID,
        sessionId,
        projectStoragePath,
        filePath: found.filePath,
        fileMtimeMs: found.row.updatedMs,
        sourceSessionKey: sessionId,
      } satisfies SourceSessionRef;
    });

  const detect = () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* rootPath;

      const exists = yield* fs
        .exists(yield* databasePath)
        .pipe(Effect.catchAll(() => Effect.succeed(false)));
      if (!exists) {
        return {
          sourceId: GOOSE_SOURCE_ID,
          rootPath: null,
          hasData: false,
          supported: false,
          unsupportedReason: "not-installed",
        } satisfies SourceDetection;
      }

      const tables = yield* databasePath.pipe(
        Effect.flatMap((file) =>
          withReadOnlyDatabase(file, (db) => hasTables(db, REQUIRED_TABLES)),
        ),
        Effect.either,
      );

      if (tables._tag === "Left") {
        return {
          sourceId: GOOSE_SOURCE_ID,
          rootPath: root,
          hasData: true,
          supported: false,
          unsupportedReason: tables.left.reason === "unreadable" ? "unreadable" : "schema-changed",
        } satisfies SourceDetection;
      }

      if (!tables.right) {
        return {
          sourceId: GOOSE_SOURCE_ID,
          rootPath: root,
          hasData: true,
          supported: false,
          unsupportedReason: "schema-changed",
        } satisfies SourceDetection;
      }

      const found = yield* sessions.pipe(Effect.either);
      if (found._tag === "Left") {
        return {
          sourceId: GOOSE_SOURCE_ID,
          rootPath: root,
          hasData: true,
          supported: false,
          unsupportedReason: "schema-changed",
        } satisfies SourceDetection;
      }

      if (found.right.length === 0) {
        return {
          sourceId: GOOSE_SOURCE_ID,
          rootPath: root,
          hasData: false,
          supported: false,
          unsupportedReason: "no-data",
        } satisfies SourceDetection;
      }

      // Read real sessions rather than trusting the schema. "Queried without
      // complaint" is not the test: a statement that still runs against rows
      // whose documents changed yields empty conversations, which is how a
      // whole history renders blank while looking like it worked.
      for (const candidate of found.right.slice(0, DETECT_SAMPLE)) {
        const parsed = yield* readOne(candidate).pipe(Effect.either);
        if (
          parsed._tag === "Right" &&
          parsed.right.entries.length > 0 &&
          parsed.right.parseStats.unparsed === 0
        ) {
          return {
            sourceId: GOOSE_SOURCE_ID,
            rootPath: root,
            hasData: true,
            supported: true,
            unsupportedReason: null,
          } satisfies SourceDetection;
        }
      }

      return {
        sourceId: GOOSE_SOURCE_ID,
        rootPath: root,
        hasData: true,
        supported: false,
        unsupportedReason: "schema-changed",
      } satisfies SourceDetection;
    });

  return {
    id: GOOSE_SOURCE_ID,
    displayName: "goose",
    capabilities: {
      // One database holds everything, so a changed path names no session and
      // `classifyChange` has nothing to answer with. The interval sync covers it.
      watch: false,
      interactive: false,
      deletable: false,
      cost: "reported",
    },
    detect,
    listProjects,
    resolveProjectCwd,
    listSessions,
    readSession,
    resolveSessionRef,
    roots: () => rootPath.pipe(Effect.map((root) => [root])),
    classifyChange: () => null,
    headless: {
      executable: () => resolveOnPath(GOOSE_SOURCE_ID, "goose"),
      args: (prompt) => ["run", "--text", prompt],
      // goose prints the reply as prose and reports no cost on this path.
      parse: (stdout) => ({ text: stdout, costUsd: 0 }),
    },
  };
};

export const gooseSourceAdapter = makeAdapter();

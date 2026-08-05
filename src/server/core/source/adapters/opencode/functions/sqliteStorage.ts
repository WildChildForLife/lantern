import { FileSystem, Path } from "@effect/platform";
import { Effect } from "effect";
import { ApplicationContext } from "../../../../platform/services/ApplicationContext.ts";
import { canonicalizeProjectPath } from "../../../functions/canonicalizeProjectPath.ts";
import { withReadOnlyDatabase } from "../../../functions/readOnlySqlite.ts";
import { virtualProjectPath } from "../../../functions/virtualProjectPath.ts";
import {
  type SourceDetection,
  type SourceProject,
  SourceReadError,
  type SourceSession,
  SourceSessionGoneError,
  type SourceSessionRef,
} from "../../../models/SourceEntities.ts";
import { OPENCODE_SOURCE_ID } from "../../../models/SourceId.ts";
import { type MessageFile, parseMessages } from "./parseMessages.ts";
import {
  type OpencodeSessionRow,
  readMessages as readRows,
  readSessions as readSessionRows,
} from "./readSqlite.ts";

/**
 * opencode's second storage mode, kept whole rather than as branches through
 * the adapter.
 *
 * As of 1.18.13 — the current release — this is what a normal install looks
 * like: one `opencode.db` and no storage tree at all. The transcript dialect is
 * unchanged, so everything here ends at the same parser the file layout uses;
 * only where the documents live is different.
 */
const DATABASE_FILE = "opencode.db";

/**
 * How many sessions `detect` reads before giving up.
 *
 * More than one, because an abandoned session holds no conversation and reading
 * only the first would report a healthy install as broken. Bounded, because
 * this runs on every settings render and an install whose schema has moved must
 * not cost a full read of the history.
 */
const DETECT_SAMPLE = 5;

/** A session row, with the identities Lantern files it under. */
type LocatedSession = {
  readonly row: OpencodeSessionRow;
  readonly canonical: string;
  readonly storagePath: string;
  readonly filePath: string;
};

export const makeSqliteStorage = (rootPath: Effect.Effect<string, never, SqliteEnv>) => {
  const databasePath = Effect.gen(function* () {
    const path = yield* Path.Path;
    return path.join(yield* rootPath, DATABASE_FILE);
  });

  const exists = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.exists(yield* databasePath).pipe(Effect.catchAll(() => Effect.succeed(false)));
  });

  const canonicalizeOptions = Effect.gen(function* () {
    const context = yield* ApplicationContext;
    const home = yield* context.homeDirectory;

    return {
      homeDirectory: home ?? undefined,
      platform: context.platform,
    };
  });

  /**
   * Every session in the database, with a workspace and a path minted for it.
   *
   * The database keeps no directory per project, so the project id is derived
   * from the working directory each session recorded — the same treatment Codex
   * and Copilot CLI get for the same reason.
   */
  const sessions = Effect.gen(function* () {
    const path = yield* Path.Path;
    const root = yield* rootPath;
    const options = yield* canonicalizeOptions;

    const rows = yield* withReadOnlyDatabase(yield* databasePath, readSessionRows).pipe(
      Effect.catchAll(() => Effect.succeed<readonly OpencodeSessionRow[]>([])),
    );

    return rows.flatMap((row) => {
      if (row.directory === null || row.directory === "") return [];

      const canonical = canonicalizeProjectPath(row.directory, options);
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

  const messagesFor = (sessionId: string) =>
    databasePath.pipe(
      Effect.flatMap((file) =>
        withReadOnlyDatabase(file, (database) => readRows(database, sessionId)),
      ),
    );

  const listProjects = Effect.gen(function* () {
    const byCanonical = new Map<string, { cwd: string; storagePath: string; mtimeMs: number }>();

    for (const { row, canonical, storagePath } of yield* sessions) {
      const existing = byCanonical.get(canonical);
      byCanonical.set(canonical, {
        cwd: existing?.cwd ?? row.directory ?? "",
        storagePath,
        // No project directory to take a timestamp from, so the most recently
        // touched session stands in for one.
        mtimeMs: Math.max(existing?.mtimeMs ?? 0, row.updatedMs),
      });
    }

    return [...byCanonical.entries()].map(([canonical, found]) => ({
      sourceId: OPENCODE_SOURCE_ID,
      storagePath: found.storagePath,
      cwd: found.cwd,
      sourceProjectKey: canonical,
      dirMtimeMs: found.mtimeMs,
    })) satisfies SourceProject[];
  });

  const listSessions = (project: SourceProject) =>
    sessions.pipe(
      Effect.map(
        (found) =>
          found
            .filter((candidate) => candidate.canonical === project.sourceProjectKey)
            .map((candidate) => ({
              sourceId: OPENCODE_SOURCE_ID,
              sessionId: candidate.row.id,
              projectStoragePath: project.storagePath,
              filePath: candidate.filePath,
              fileMtimeMs: candidate.row.updatedMs,
              sourceSessionKey: candidate.row.id,
            })) satisfies SourceSessionRef[],
      ),
    );

  const readSession = (ref: SourceSessionRef) =>
    Effect.gen(function* () {
      const found = (yield* sessions).find(
        (candidate) => candidate.row.id === ref.sourceSessionKey,
      );
      if (found === undefined) {
        return yield* new SourceReadError({
          sourceId: OPENCODE_SOURCE_ID,
          path: ref.filePath,
          reason: "session is not in the database",
        });
      }

      const files = yield* messagesFor(found.row.id).pipe(
        Effect.mapError(
          (cause) =>
            new SourceReadError({
              sourceId: OPENCODE_SOURCE_ID,
              path: cause.path,
              reason: cause.detail,
              cause,
            }),
        ),
      );

      const parsed = parseMessages(files, {
        sessionKey: found.row.id,
        cwd: found.row.directory ?? "",
        version: "unknown",
      });

      return {
        ref,
        entries: parsed.entries,
        messageCount: parsed.messageCount,
        usageTexts: [],
        // The session row totals its own usage, which beats re-summing the
        // per-message parts that produced it.
        reportedUsage: {
          costUsd: found.row.costUsd,
          inputTokens: found.row.inputTokens,
          outputTokens: found.row.outputTokens,
          cacheReadTokens: found.row.cacheReadTokens,
          cacheCreationTokens: found.row.cacheWriteTokens,
          modelName: found.row.modelName ?? parsed.modelName,
        },
        parseStats: parsed.parseStats,
      } satisfies SourceSession;
    });

  const resolveSessionRef = (projectStoragePath: string, sessionId: string) =>
    Effect.gen(function* () {
      const found = (yield* sessions).find(
        (candidate) =>
          candidate.row.id === sessionId && candidate.storagePath === projectStoragePath,
      );
      if (found === undefined) {
        return yield* new SourceSessionGoneError({ sourceId: OPENCODE_SOURCE_ID, sessionId });
      }

      return {
        sourceId: OPENCODE_SOURCE_ID,
        sessionId,
        projectStoragePath,
        filePath: found.filePath,
        fileMtimeMs: found.row.updatedMs,
        sourceSessionKey: sessionId,
      } satisfies SourceSessionRef;
    });

  const detect = (root: string) =>
    Effect.gen(function* () {
      const found = yield* sessions;
      if (found.length === 0) {
        return {
          sourceId: OPENCODE_SOURCE_ID,
          rootPath: root,
          hasData: false,
          supported: false,
          unsupportedReason: "no-data",
        } satisfies SourceDetection;
      }

      // Read real sessions rather than trusting the schema. "Queried without
      // complaint" is not the test: a statement that still runs against a table
      // whose documents changed yields empty conversations, which is how a
      // whole history renders blank while looking like it worked.
      for (const candidate of found.slice(0, DETECT_SAMPLE)) {
        const files = yield* messagesFor(candidate.row.id).pipe(
          Effect.catchAll(() => Effect.succeed<readonly MessageFile[]>([])),
        );

        const parsed = parseMessages(files, {
          sessionKey: candidate.row.id,
          cwd: candidate.row.directory ?? "",
          version: "unknown",
        });

        if (parsed.entries.length > 0 && parsed.parseStats.unparsed === 0) {
          return {
            sourceId: OPENCODE_SOURCE_ID,
            rootPath: root,
            hasData: true,
            supported: true,
            unsupportedReason: null,
          } satisfies SourceDetection;
        }
      }

      return {
        sourceId: OPENCODE_SOURCE_ID,
        rootPath: root,
        hasData: true,
        supported: false,
        unsupportedReason: "schema-changed",
      } satisfies SourceDetection;
    });

  return { exists, listProjects, listSessions, readSession, resolveSessionRef, detect };
};

export type SqliteEnv = FileSystem.FileSystem | Path.Path | ApplicationContext;

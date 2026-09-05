import { FileSystem, Path } from "@effect/platform";
import { Effect } from "effect";
import { ApplicationContext } from "../../../../platform/services/ApplicationContext.ts";
import { canonicalizeProjectPath } from "../../../functions/canonicalizeProjectPath.ts";
import {
  type ForeignDatabase,
  type ForeignDatabaseError,
  hasTables,
  withReadOnlyDatabase,
} from "../../../functions/readOnlySqlite.ts";
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
import { parseMessages } from "./parseMessages.ts";
import {
  hasSessions as hasSessionRows,
  type OpencodeSessionRow,
  readMessages,
  readSessionById,
  readSessions,
  REQUIRED_TABLES,
} from "./readSqlite.ts";

/**
 * opencode's second storage mode, kept whole rather than as branches through
 * the adapter.
 *
 * As of 1.18.13, and still true at 1.18.27, this is what a normal install looks
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
   * One open, for one piece of work.
   *
   * Everything that touches the database goes through here, so an operation
   * costs a single open however many statements it runs — and no failure is
   * turned into an empty result on the way out. A caller that swallows a read
   * error reports "no sessions", which upstream cannot tell from "this install
   * has none" and which `SyncService` acts on by deleting the cached rows.
   */
  const withDatabase = <A>(
    use: (database: ForeignDatabase) => Effect.Effect<A, ForeignDatabaseError>,
  ): Effect.Effect<A, ForeignDatabaseError, SqliteEnv> =>
    databasePath.pipe(Effect.flatMap((file) => withReadOnlyDatabase(file, use)));

  /**
   * Whether this install keeps its sessions here rather than in the tree.
   *
   * Only the positive answer is remembered, and the set is only ever added to:
   * a database that holds sessions does not stop holding them, while one that
   * holds none may gain its first at any moment and has to keep being asked.
   * Memoised at all because the storage mode is settled on every call into the
   * adapter, and the answer costs an open. Keyed by root so that two configured
   * roots — or two tests — cannot answer for each other.
   */
  const rootsHoldingSessions = new Set<string>();

  const holdsSessions = Effect.gen(function* () {
    const root = yield* rootPath;
    if (rootsHoldingSessions.has(root)) return true;

    const held = yield* withDatabase(hasSessionRows);
    if (held) rootsHoldingSessions.add(root);

    return held;
  });

  /**
   * Session rows, with the workspace and the paths Lantern files them under.
   *
   * The database keeps no directory per project, so the project id is derived
   * from the working directory each session recorded — the same treatment Codex
   * and Copilot CLI get for the same reason.
   */
  const locate = (rows: readonly OpencodeSessionRow[]) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const root = yield* rootPath;
      const options = yield* canonicalizeOptions;

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

  /** Every session in the database, newest first. */
  const sessions = withDatabase(readSessions).pipe(Effect.flatMap(locate));

  /** A read failure is this source's failure, not an empty history. */
  const asReadError = (cause: ForeignDatabaseError) =>
    new SourceReadError({
      sourceId: OPENCODE_SOURCE_ID,
      path: cause.path,
      reason: cause.detail,
      cause,
    });

  const listProjects = Effect.gen(function* () {
    const byCanonical = new Map<string, { cwd: string; storagePath: string; mtimeMs: number }>();

    for (const { row, canonical, storagePath } of yield* sessions.pipe(
      Effect.mapError(asReadError),
    )) {
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
      Effect.mapError(asReadError),
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

  /**
   * One session and its messages, in one open.
   *
   * The row is fetched by id rather than found in a listing: a sync reads
   * sessions one at a time, and scanning the whole table for each of them turns
   * a history into quadratic work against the file it is stored in.
   */
  const readOneSession = (sessionId: string) =>
    withDatabase((database) =>
      Effect.gen(function* () {
        const row = yield* readSessionById(database, sessionId);
        if (row === null) return null;

        return { row, files: yield* readMessages(database, sessionId) };
      }),
    );

  const readSession = (ref: SourceSessionRef) =>
    Effect.gen(function* () {
      const read = yield* readOneSession(ref.sourceSessionKey).pipe(Effect.mapError(asReadError));
      if (read === null) {
        return yield* new SourceReadError({
          sourceId: OPENCODE_SOURCE_ID,
          path: ref.filePath,
          reason: "session is not in the database",
        });
      }

      const { row, files } = read;
      const parsed = parseMessages(files, {
        sessionKey: row.id,
        cwd: row.directory ?? "",
        version: "unknown",
      });

      if (parsed.parseStats.unparsed > 0) {
        yield* Effect.logWarning(
          `${parsed.parseStats.unparsed} unreadable messages in session ${row.id} of ${DATABASE_FILE}: ${parsed.unparsedFiles.join(" | ")}`,
        );
      }

      return {
        ref,
        entries: parsed.entries,
        messageCount: parsed.messageCount,
        usageTexts: [],
        // The session row totals its own usage, which beats re-summing the
        // per-message parts that produced it.
        reportedUsage: {
          costUsd: row.costUsd,
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          cacheReadTokens: row.cacheReadTokens,
          cacheCreationTokens: row.cacheWriteTokens,
          modelName: row.modelName ?? parsed.modelName,
        },
        parseStats: parsed.parseStats,
      } satisfies SourceSession;
    });

  const resolveSessionRef = (projectStoragePath: string, sessionId: string) =>
    Effect.gen(function* () {
      const row = yield* withDatabase((database) => readSessionById(database, sessionId)).pipe(
        Effect.mapError(asReadError),
      );

      // A session under the wrong workspace is as gone as one that never
      // existed: the minted project path is what says which workspace it
      // belongs to, and it must match the one being asked about.
      const found = row === null ? undefined : (yield* locate([row])).at(0);
      if (found === undefined || found.storagePath !== projectStoragePath) {
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

  /**
   * A verdict on the database, in one open.
   *
   * `null` means "read a real session and it came back a conversation" — the
   * only thing that earns `supported`. Anything else names the reason, so a
   * database that cannot be opened is never reported as an install with no
   * history: those are different problems and only one of them is the user's.
   */
  const probe = withDatabase((database) =>
    Effect.gen(function* () {
      if (!(yield* hasTables(database, REQUIRED_TABLES))) return "schema-changed";

      const rows = yield* readSessions(database);
      if (rows.length === 0) return "no-data";

      // Read real sessions rather than trusting the schema. "Queried without
      // complaint" is not the test: a statement that still runs against a table
      // whose documents changed yields empty conversations, which is how a
      // whole history renders blank while looking like it worked.
      for (const row of rows.slice(0, DETECT_SAMPLE)) {
        const parsed = parseMessages(yield* readMessages(database, row.id), {
          sessionKey: row.id,
          cwd: row.directory ?? "",
          version: "unknown",
        });

        if (parsed.entries.length > 0 && parsed.parseStats.unparsed === 0) return null;
      }

      return "schema-changed";
    }),
  );

  const detect = (root: string) =>
    probe.pipe(
      // The reader tells corruption apart from a schema that moved; throwing
      // that away here would put both under "no sessions recorded yet" and send
      // someone looking for a history that is in fact sitting in an unreadable
      // file.
      Effect.catchAll((cause) => Effect.succeed(cause.reason)),
      Effect.map((reason) => {
        if (reason === null) {
          return {
            sourceId: OPENCODE_SOURCE_ID,
            rootPath: root,
            hasData: true,
            supported: true,
            unsupportedReason: null,
          } satisfies SourceDetection;
        }

        return {
          sourceId: OPENCODE_SOURCE_ID,
          rootPath: root,
          // A database that will not open holds an unknown amount of history,
          // and "no data" is the one answer that is certainly wrong.
          hasData: reason !== "no-data",
          supported: false,
          unsupportedReason: reason,
        } satisfies SourceDetection;
      }),
    );

  return {
    exists,
    holdsSessions,
    listProjects,
    listSessions,
    readSession,
    resolveSessionRef,
    detect,
  };
};

export type SqliteEnv = FileSystem.FileSystem | Path.Path | ApplicationContext;

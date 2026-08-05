/* oxlint-disable no-restricted-imports */
/* Exception: the DrizzleService rule points at Lantern's own cache database.
   This opens another program's database, read-only, and must not go through a
   service that owns migrations and a schema. */
import { DatabaseSync } from "node:sqlite";
import { Data, Effect } from "effect";

/**
 * Opening another CLI's session database, read-only.
 *
 * Several agent CLIs have moved their history from files into SQLite — opencode
 * as of 1.18.13, goose since 1.10 — so this is a storage mode rather than
 * another transcript dialect. The rules that make it safe to read someone
 * else's live database:
 *
 * - **Read-only, always.** Lantern never writes another CLI's history, and a
 *   read-write handle on a database the CLI has open invites corruption.
 * - **Not `immutable`.** The tempting flag skips locking entirely, but it also
 *   ignores the write-ahead log — and a CLI that is running keeps its most
 *   recent turns there. Reading `immutable` would silently show a stale
 *   history, which is worse than failing.
 * - **Every query guarded.** A schema that moved must surface as a reason the
 *   settings screen can show, not as an exception out of a sync fibre.
 */
export class ForeignDatabaseError extends Data.TaggedError("ForeignDatabaseError")<{
  readonly path: string;
  readonly reason: "unreadable" | "schema-changed";
  readonly detail: string;
}> {}

export type ForeignDatabase = {
  /**
   * Rows for a query, or a `schema-changed` failure when the statement no
   * longer matches the database — a renamed column throws at prepare time, and
   * a sync fibre is the wrong place to find out.
   */
  readonly all: (
    sql: string,
    ...parameters: readonly string[]
  ) => Effect.Effect<readonly Record<string, unknown>[], ForeignDatabaseError>;
};

/** The tables a query needs, checked before it is run. */
export const hasTables = (
  database: ForeignDatabase,
  required: readonly string[],
): Effect.Effect<boolean, ForeignDatabaseError> =>
  database.all("select name from sqlite_master where type = 'table'").pipe(
    Effect.map((rows) => {
      const present = new Set(rows.map((row) => String(row["name"])));
      return required.every((name) => present.has(name));
    }),
  );

/**
 * Opens a database for reading and hands it to `use`, closing it afterwards
 * whether or not that succeeded.
 *
 * Scoped rather than returned, because a handle on another program's database
 * is not something to leave lying open: SQLite keeps a lock for as long as it
 * lives, and the CLI that owns the file may want to write.
 */
export const withReadOnlyDatabase = <A, E>(
  databasePath: string,
  use: (database: ForeignDatabase) => Effect.Effect<A, E>,
): Effect.Effect<A, E | ForeignDatabaseError> =>
  Effect.acquireUseRelease(
    Effect.try({
      try: () => {
        // `readOnly` alone keeps normal locking, so the write-ahead log is
        // still read and a running CLI's newest turns are visible.
        const sqlite = new DatabaseSync(databasePath, { readOnly: true });

        // Opening is lazy: SQLite does not look at the file header until the
        // first statement, so a missing or corrupt file opens happily and only
        // fails later — where it would be reported as a schema that moved,
        // blaming the CLI for a file that is simply not a database.
        try {
          sqlite.prepare("select count(*) from sqlite_master").get();
        } catch (cause) {
          sqlite.close();
          throw cause;
        }

        return sqlite;
      },
      catch: (cause) =>
        new ForeignDatabaseError({
          path: databasePath,
          reason: "unreadable",
          detail: cause instanceof Error ? cause.message : String(cause),
        }),
    }),
    (sqlite) =>
      use({
        all: (sql, ...parameters) =>
          Effect.try({
            try: () => sqlite.prepare(sql).all(...parameters),
            catch: (cause) =>
              new ForeignDatabaseError({
                path: databasePath,
                reason: "schema-changed",
                detail: cause instanceof Error ? cause.message : String(cause),
              }),
          }),
      }),
    (sqlite) =>
      Effect.sync(() => {
        try {
          sqlite.close();
        } catch {
          // Already closed, or the file went away while it was open. Neither is
          // worth failing a read that has already produced its rows.
        }
      }),
  );

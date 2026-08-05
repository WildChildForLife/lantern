/* This test writes a throwaway database, so the reader is checked against a
   real file rather than a mock. */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { hasTables, withReadOnlyDatabase } from "./readOnlySqlite.ts";

const directory = mkdtempSync(join(tmpdir(), "lantern-foreign-db-"));

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** A database standing in for another CLI's, written the way that CLI would. */
const makeDatabase = (name: string, build: (database: DatabaseSync) => void): string => {
  const path = join(directory, name);
  const database = new DatabaseSync(path);
  build(database);
  database.close();
  return path;
};

const SESSIONS = makeDatabase("sessions.db", (database) => {
  database.exec("create table session (id text primary key, title text)");
  database.exec("insert into session values ('s1', 'first'), ('s2', 'second')");
});

describe("withReadOnlyDatabase", () => {
  it("reads rows out of another program's database", async () => {
    const rows = await Effect.runPromise(
      withReadOnlyDatabase(SESSIONS, (database) => database.all("select id, title from session")),
    );

    expect(rows).toEqual([
      { id: "s1", title: "first" },
      { id: "s2", title: "second" },
    ]);
  });

  it("binds parameters rather than interpolating them", async () => {
    const rows = await Effect.runPromise(
      withReadOnlyDatabase(SESSIONS, (database) =>
        database.all("select id from session where id = ?", "s2"),
      ),
    );

    expect(rows).toEqual([{ id: "s2" }]);
  });

  it("never writes, whatever it is asked to do", async () => {
    // Lantern only ever reads another CLI's history. A read-write handle on a
    // database the CLI has open is also how you corrupt one.
    const failure = await Effect.runPromise(
      withReadOnlyDatabase(SESSIONS, (database) =>
        database.all("insert into session values ('s3', 'third')"),
      ).pipe(Effect.flip),
    );

    expect(failure.reason).toBe("schema-changed");

    const after = await Effect.runPromise(
      withReadOnlyDatabase(SESSIONS, (database) => database.all("select id from session")),
    );
    expect(after).toHaveLength(2);
  });

  it("reports a moved schema as a reason rather than throwing", async () => {
    // A renamed column fails at prepare time. Surfacing that as a typed reason
    // is what lets the settings screen say "schema-changed" instead of a sync
    // fibre dying somewhere out of sight.
    const failure = await Effect.runPromise(
      withReadOnlyDatabase(SESSIONS, (database) =>
        database.all("select no_such_column from session"),
      ).pipe(Effect.flip),
    );

    expect(failure.reason).toBe("schema-changed");
    expect(failure.path).toBe(SESSIONS);
  });

  it("reports a file that is not a database as unreadable", async () => {
    const path = join(directory, "not-a-database.db");
    writeFileSync(path, "this is not SQLite");

    const failure = await Effect.runPromise(
      withReadOnlyDatabase(path, (database) => database.all("select 1")).pipe(Effect.flip),
    );

    expect(failure.reason).toBe("unreadable");
  });

  it("reports a missing file as unreadable rather than creating one", async () => {
    const path = join(directory, "absent.db");

    const failure = await Effect.runPromise(
      withReadOnlyDatabase(path, (database) => database.all("select 1")).pipe(Effect.flip),
    );

    expect(failure.reason).toBe("unreadable");
    // Opening read-write would have created it — a file Lantern has no business
    // leaving behind in another program's directory.
    expect(existsSync(path)).toBe(false);
  });

  it("closes the handle even when the read fails", async () => {
    // SQLite holds a lock for as long as the handle lives, and the CLI that
    // owns the file may want to write. A leaked handle on the failure path is
    // the one nobody notices.
    await Effect.runPromise(
      withReadOnlyDatabase(SESSIONS, (database) => database.all("select bad from session")).pipe(
        Effect.flip,
      ),
    );

    const reopened = new DatabaseSync(SESSIONS, { readOnly: true });
    expect(reopened.prepare("select count(*) as n from session").get()).toEqual({ n: 2 });
    reopened.close();
  });
});

describe("hasTables", () => {
  it("says whether every table a query needs is present", async () => {
    const present = await Effect.runPromise(
      withReadOnlyDatabase(SESSIONS, (database) => hasTables(database, ["session"])),
    );
    const absent = await Effect.runPromise(
      withReadOnlyDatabase(SESSIONS, (database) => hasTables(database, ["session", "message"])),
    );

    expect(present).toBe(true);
    expect(absent).toBe(false);
  });
});

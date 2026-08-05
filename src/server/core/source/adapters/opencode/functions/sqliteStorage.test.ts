import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
/* These tests copy the committed 1.18.13 fixture and edit the copy, so every
   case is a real database rather than a mock of one. */
import { NodeContext } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { afterAll, describe, expect } from "vitest";
import { testPlatformLayer } from "../../../../../../testing/layers/testPlatformLayer.ts";
import { opencodeSourceAdapter } from "../OpencodeSourceAdapter.ts";

const FIXTURE_DATABASE = `${process.cwd()}/fixtures/opencode-sqlite/opencode.db`;
/** The file layout, for the installs that still have one beside the database. */
const FIXTURE_TREE = `${process.cwd()}/fixtures/opencode-home`;

const directory = mkdtempSync(join(tmpdir(), "lantern-opencode-sqlite-"));
const openHandles: DatabaseSync[] = [];

afterAll(() => {
  for (const handle of openHandles) {
    try {
      handle.close();
    } catch {
      // Already closed by the test that opened it.
    }
  }
  rmSync(directory, { recursive: true, force: true });
});

/** An opencode home, built the way the install under test would have. */
const makeRoot = (
  name: string,
  build?: { readonly tree?: boolean; readonly edit?: (database: DatabaseSync) => void },
): string => {
  const root = join(directory, name);
  mkdirSync(root, { recursive: true });

  if (build?.tree === true) {
    cpSync(FIXTURE_TREE, root, { recursive: true });
  }

  cpSync(FIXTURE_DATABASE, join(root, "opencode.db"));

  if (build?.edit !== undefined) {
    const database = new DatabaseSync(join(root, "opencode.db"));
    build.edit(database);
    database.close();
  }

  return root;
};

const layerFor = (root: string) =>
  Layer.mergeAll(
    testPlatformLayer({ sourceRoots: { opencode: root }, env: { HOME: "/home/demo" } }),
    NodeContext.layer,
  );

/** Every session the adapter can reach, whichever layout it decided to read. */
const readableSessions = Effect.gen(function* () {
  const found = yield* opencodeSourceAdapter.listProjects();

  const cwds: string[] = [];
  let total = 0;
  for (const project of found) {
    cwds.push(project.cwd ?? "");
    total += (yield* opencodeSourceAdapter.listSessions(project)).length;
  }

  return { projects: found.length, sessions: total, cwds };
});

describe("choosing between opencode's two storage layouts", () => {
  it.live("reads the database of an install that migrated and kept its old tree", () => {
    // The migration leaves `storage/` behind, so this is what every install
    // that upgraded looks like. Preferring the tree here would show a history
    // frozen on the day they migrated — and call it supported.
    const root = makeRoot("migrated", { tree: true });

    return Effect.gen(function* () {
      const detection = yield* opencodeSourceAdapter.detect();
      expect(detection.supported).toBe(true);

      const { projects, sessions, cwds } = yield* readableSessions;
      // The database's workspace, not the three the leftover tree holds.
      expect(cwds).toStrictEqual(["/work"]);
      expect(projects).toBe(1);
      expect(sessions).toBe(3);
    }).pipe(Effect.provide(layerFor(root)));
  });

  it.live("reads the tree when the database has no sessions in it yet", () => {
    // A fresh install writes the database before it has anything to put in it.
    const root = makeRoot("not-yet-migrated", {
      tree: true,
      edit: (database) => database.exec("delete from session"),
    });

    return Effect.gen(function* () {
      const { sessions, cwds } = yield* readableSessions;
      expect(sessions).toBeGreaterThan(0);
      expect(cwds).not.toContain("/work");
    }).pipe(Effect.provide(layerFor(root)));
  });

  it.live("reads the tree when there is no database at all", () => {
    const root = join(directory, "tree-only");
    cpSync(FIXTURE_TREE, root, { recursive: true });

    return Effect.gen(function* () {
      const detection = yield* opencodeSourceAdapter.detect();
      expect(detection.supported).toBe(true);
      expect((yield* readableSessions).sessions).toBeGreaterThan(0);
    }).pipe(Effect.provide(layerFor(root)));
  });
});

describe("a database that cannot be read", () => {
  it.live("fails to list rather than reporting an install with no projects", () => {
    // What upstream does with an empty listing is delete every cached row for
    // this source, so "could not read" must not arrive looking like "has none".
    const root = makeRoot("moved-schema", {
      edit: (database) => database.exec("alter table session rename to session_v2"),
    });

    return Effect.gen(function* () {
      const failure = yield* opencodeSourceAdapter.listProjects().pipe(Effect.flip);
      expect(failure._tag).toBe("SourceReadError");
    }).pipe(Effect.provide(layerFor(root)));
  });

  it.live("reports a moved schema as such, not as an empty history", () => {
    const root = makeRoot("moved-schema-detect", {
      edit: (database) => database.exec("alter table message rename to message_v2"),
    });

    return Effect.gen(function* () {
      const detection = yield* opencodeSourceAdapter.detect();

      expect(detection.hasData).toBe(true);
      expect(detection.supported).toBe(false);
      expect(detection.unsupportedReason).toBe("schema-changed");
    }).pipe(Effect.provide(layerFor(root)));
  });

  it.live("reports a file that is not a database as unreadable", () => {
    const root = join(directory, "corrupt");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "opencode.db"), "this is not SQLite");

    return Effect.gen(function* () {
      const detection = yield* opencodeSourceAdapter.detect();

      // Not "no sessions recorded yet": the history may all be sitting in
      // there, and telling someone they have none sends them somewhere else.
      expect(detection.hasData).toBe(true);
      expect(detection.unsupportedReason).toBe("unreadable");
    }).pipe(Effect.provide(layerFor(root)));
  });

  it.live("reports an empty database as no data", () => {
    const root = makeRoot("empty", {
      edit: (database) => {
        database.exec("delete from part");
        database.exec("delete from message");
        database.exec("delete from session");
      },
    });

    return Effect.gen(function* () {
      const detection = yield* opencodeSourceAdapter.detect();

      expect(detection.hasData).toBe(false);
      expect(detection.unsupportedReason).toBe("no-data");
    }).pipe(Effect.provide(layerFor(root)));
  });
});

describe("reading a conversation out of the database", () => {
  it.live("counts a message it cannot read rather than dropping it", () => {
    // A `data` column that is not text is what a release storing compressed or
    // binary documents would write. Dropping the row would lose a message and
    // count nothing, which is a format change that looks like it worked.
    const root = makeRoot("blob-message", {
      edit: (database) => {
        const newest = database
          .prepare("select id from session order by time_updated desc limit 1")
          .get();
        const target = database
          .prepare("select id from message where session_id = ? order by time_created, id limit 1")
          .get(String(newest?.["id"]));

        database
          .prepare("update message set data = ? where id = ?")
          .run(new Uint8Array([0, 1, 2]), String(target?.["id"]));
      },
    });

    return Effect.gen(function* () {
      const project = (yield* opencodeSourceAdapter.listProjects()).at(0);
      if (project === undefined) throw new Error("fixture workspace missing");

      const ref = (yield* opencodeSourceAdapter.listSessions(project)).at(0);
      if (ref === undefined) throw new Error("fixture session missing");

      const read = yield* opencodeSourceAdapter.readSession(ref);
      expect(read.parseStats.unparsed).toBe(1);
      // Counted, so the message is still part of the total rather than gone.
      expect(read.parseStats.total).toBe(11);
    }).pipe(Effect.provide(layerFor(root)));
  });

  it.live("reports the model's name, not the document the column holds", () => {
    // `session.model` is `{"id":"…","providerID":"…"}`, and passing it on unread
    // puts JSON everywhere Lantern shows a model.
    const root = makeRoot("model-name");

    return Effect.gen(function* () {
      const project = (yield* opencodeSourceAdapter.listProjects()).at(0);
      if (project === undefined) throw new Error("fixture workspace missing");

      const ref = (yield* opencodeSourceAdapter.listSessions(project)).at(0);
      if (ref === undefined) throw new Error("fixture session missing");

      const read = yield* opencodeSourceAdapter.readSession(ref);
      expect(read.reportedUsage?.modelName).toBe("qwen3:0.6b");
    }).pipe(Effect.provide(layerFor(root)));
  });

  it.live("sees turns a running opencode has only written to the write-ahead log", () => {
    // Why the reader does not open `immutable`: that flag skips the WAL, and a
    // CLI that is running keeps its newest turns there. A stale history read
    // without complaint is worse than a failure.
    const root = makeRoot("write-ahead-log");
    const running = new DatabaseSync(join(root, "opencode.db"));
    openHandles.push(running);

    running.exec("pragma journal_mode = wal");
    running.exec(`insert into session (
        id, project_id, slug, directory, title, version, cost,
        tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
        time_created, time_updated
      ) values (
        'ses_live', 'global', 'live', '/work', 'a turn still in the log', '1.18.13', 0,
        0, 0, 0, 0, 0, 1785878985638, 1785878985638
      )`);

    return Effect.gen(function* () {
      const project = (yield* opencodeSourceAdapter.listProjects()).at(0);
      if (project === undefined) throw new Error("fixture workspace missing");

      const refs = yield* opencodeSourceAdapter.listSessions(project);
      expect(refs.map((ref) => ref.sessionId)).toContain("ses_live");
    }).pipe(Effect.provide(layerFor(root)));
  });
});

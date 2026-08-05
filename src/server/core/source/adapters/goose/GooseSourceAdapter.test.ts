/* This test builds a throwaway copy of the fixture with a moved schema, so the
   failure paths run against a real database rather than a mock. */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NodeContext } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { afterAll, describe, expect } from "vitest";
import { makeDrizzleTestServiceLayer } from "../../../../../testing/layers/testDrizzleServiceLayer.ts";
import { testPlatformLayer } from "../../../../../testing/layers/testPlatformLayer.ts";
import { DrizzleService } from "../../../../lib/db/DrizzleService.ts";
import { projects, sessions } from "../../../../lib/db/schema.ts";
import { ProjectRepository } from "../../../project/infrastructure/ProjectRepository.ts";
import { ProjectMetaService } from "../../../project/services/ProjectMetaService.ts";
import { SessionRepository } from "../../../session/infrastructure/SessionRepository.ts";
import { SessionLocatorService } from "../../../session/services/SessionLocatorService.ts";
import { SessionMetaService } from "../../../session/services/SessionMetaService.ts";
import { createMockSessionMeta } from "../../../session/testing/createMockSessionMeta.ts";
import { SyncService } from "../../../sync/services/SyncService.ts";
import { SourceRegistry } from "../../services/SourceRegistry.ts";
import { gooseSourceAdapter } from "./GooseSourceAdapter.ts";

/**
 * The fixture is the database a real goose 1.45.0 wrote in `docker/`,
 * checkpointed into a single file. Nothing here is hand-authored.
 */
const GOOSE_HOME = `${process.cwd()}/fixtures/goose-home`;

const platformLayer = testPlatformLayer({
  sourceRoots: { goose: GOOSE_HOME },
  env: { HOME: "/home/demo" },
});

const adapterLayer = Layer.mergeAll(platformLayer, NodeContext.layer);

const syncLayer = Layer.mergeAll(
  makeDrizzleTestServiceLayer(),
  platformLayer,
  NodeContext.layer,
  SourceRegistry.withAdapters([gooseSourceAdapter]),
);

const readPathLayer = Layer.mergeAll(
  ProjectRepository.Live,
  SessionRepository.Live.pipe(Layer.provideMerge(SessionLocatorService.Live)),
).pipe(
  Layer.provideMerge(SyncService.Live),
  Layer.provideMerge(
    Layer.mergeAll(
      Layer.mock(ProjectMetaService, {
        getProjectMeta: () =>
          Effect.succeed({ projectName: null, projectPath: null, sessionCount: 0 }),
        invalidateProject: () => Effect.void,
      }),
      Layer.mock(SessionMetaService, {
        getSessionMeta: () => Effect.succeed(createMockSessionMeta()),
        invalidateSession: () => Effect.void,
      }),
    ),
  ),
  Layer.provideMerge(syncLayer),
);

const theProject = Effect.gen(function* () {
  const found = yield* gooseSourceAdapter.listProjects();
  const project = found.at(0);
  if (project === undefined) throw new Error("fixture workspace missing");
  return project;
});

const blocksOfType = (
  entries: readonly { readonly type: string }[],
  blockType: string,
): Record<string, unknown>[] =>
  entries.flatMap((entry) => {
    if (!("message" in entry) || typeof entry.message !== "object" || entry.message === null) {
      return [];
    }
    if (!("content" in entry.message)) return [];
    const content = entry.message.content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((block: unknown) =>
      typeof block === "object" && block !== null && "type" in block && block.type === blockType
        ? [{ ...block }]
        : [],
    );
  });

const stringField = (holder: object, key: string): string | undefined => {
  if (!(key in holder)) return undefined;
  const value: unknown = Reflect.get(holder, key);
  return typeof value === "string" ? value : undefined;
};

const readOf = (id: string) =>
  Effect.gen(function* () {
    const refs = yield* gooseSourceAdapter.listSessions(yield* theProject);
    const ref = refs.find((candidate) => candidate.sessionId === id);
    if (ref === undefined) throw new Error(`fixture session missing: ${id}`);
    return yield* gooseSourceAdapter.readSession(ref);
  });

/**
 * A copy of the fixture with one schema change applied, so the failure paths
 * can be exercised against a real database rather than a mock.
 */
const movedSchemaRoot = (() => {
  const root = mkdtempSync(join(tmpdir(), "lantern-goose-moved-"));
  mkdirSync(join(root, "sessions"), { recursive: true });
  const path = join(root, "sessions", "sessions.db");
  copyFileSync(`${GOOSE_HOME}/sessions/sessions.db`, path);

  const database = new DatabaseSync(path);
  database.exec("alter table messages rename column content_json to content");
  database.close();

  return root;
})();

afterAll(() => {
  rmSync(movedSchemaRoot, { recursive: true, force: true });
});

describe("gooseSourceAdapter", () => {
  it.live("fails to read a session rather than returning an empty one", () =>
    Effect.gen(function* () {
      // The whole point. A read that failed used to come back as a clean
      // success with no entries, and upstream acts on that by clearing the
      // session's messages and its search rows — so a goose release that
      // touched this table would have quietly emptied every conversation,
      // with `unparsed` still reading zero.
      const project = (yield* gooseSourceAdapter.listProjects()).at(0);
      if (project === undefined) throw new Error("fixture workspace missing");

      const ref = (yield* gooseSourceAdapter.listSessions(project)).at(0);
      if (ref === undefined) throw new Error("fixture session missing");

      const failure = yield* gooseSourceAdapter.readSession(ref).pipe(Effect.flip);
      expect(failure._tag).toBe("SourceReadError");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          testPlatformLayer({
            sourceRoots: { goose: movedSchemaRoot },
            env: { HOME: "/home/demo" },
          }),
          NodeContext.layer,
        ),
      ),
    ),
  );

  it.live("says the schema moved rather than reporting an empty history", () =>
    Effect.gen(function* () {
      const detection = yield* gooseSourceAdapter.detect();

      expect(detection.hasData).toBe(true);
      expect(detection.supported).toBe(false);
      expect(detection.unsupportedReason).toBe("schema-changed");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          testPlatformLayer({
            sourceRoots: { goose: movedSchemaRoot },
            env: { HOME: "/home/demo" },
          }),
          NodeContext.layer,
        ),
      ),
    ),
  );
  it.live("groups sessions by the directory each ran in", () =>
    Effect.gen(function* () {
      const found = yield* gooseSourceAdapter.listProjects();

      // One database holds everything, so a project is a grouping rather than
      // a directory and its id has to be minted.
      expect(found).toHaveLength(1);
      expect(found[0]?.cwd).toBe("/work");
      expect(found[0]?.storagePath).toContain("#projects/");
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("lists every session goose recorded", () =>
    Effect.gen(function* () {
      const refs = yield* gooseSourceAdapter.listSessions(yield* theProject);
      expect(refs).toHaveLength(4);
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("joins streamed reasoning back into one block", () =>
    Effect.gen(function* () {
      // goose writes one part per token — `{thinking: "Okay"}` — so a single
      // turn arrives as hundreds of fragments. Rendered one entry per part this
      // session produced 1486 blocks of about a word each.
      const read = yield* readOf("20260805_3");

      expect(read.entries).toHaveLength(13);
      expect(blocksOfType(read.entries, "thinking")).toHaveLength(4);
      const first = blocksOfType(read.entries, "thinking").at(0);
      expect((stringField(first ?? {}, "thinking") ?? "").length).toBeGreaterThan(50);
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("pairs each tool call with the result that answered it", () =>
    Effect.gen(function* () {
      const read = yield* readOf("20260805_3");

      const calls = blocksOfType(read.entries, "tool_use");
      const results = blocksOfType(read.entries, "tool_result");

      expect(calls).toHaveLength(4);
      expect(results.map((result) => stringField(result, "tool_use_id"))).toStrictEqual(
        calls.map((call) => stringField(call, "id")),
      );
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("treats a call that never ran as an error", () =>
    Effect.gen(function* () {
      // The first of goose's two failure levels: `status: "error"`, the tool
      // was not found.
      const read = yield* readOf("20260805_4");
      const results = blocksOfType(read.entries, "tool_result");

      expect(results.length).toBeGreaterThan(0);
      expect(results.every((result) => result["is_error"] === true)).toBe(true);
      expect(stringField(results[0] ?? {}, "content")).not.toBe("");
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("treats a call that ran and returned an error as an error too", () =>
    Effect.gen(function* () {
      // The second level, and the one the fixture actually exercises here:
      // `status: "success"` with `value.isError`. Session 3 carries both that
      // and the plain-success case, so this pins the difference rather than
      // asserting every result is a failure.
      const read = yield* readOf("20260805_3");
      const results = blocksOfType(read.entries, "tool_result");

      expect(results.length).toBeGreaterThan(1);
      expect(results.some((result) => result["is_error"] === true)).toBe(true);
      expect(results.some((result) => result["is_error"] === false)).toBe(true);
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("dates entries from the timestamp goose recorded", () =>
    Effect.gen(function* () {
      // goose keeps message times as epoch *seconds* while the session columns
      // are SQL text. A wrong unit here dates every entry to 1970 or to the
      // year 56000, and nothing else would notice.
      const read = yield* readOf("20260805_1");
      const first = read.entries.at(0);

      const timestamp = first === undefined ? undefined : stringField(first, "timestamp");
      expect(timestamp).toMatch(/^2026-08-\d{2}T/);
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("reports the model goose recorded, and no cost it did not", () =>
    Effect.gen(function* () {
      const read = yield* readOf("20260805_1");

      expect(read.reportedUsage?.modelName).toBe("qwen3:0.6b");
      expect(read.reportedUsage?.inputTokens).toBe(2050);
      // goose records no cost against a local provider, and a zero would read
      // as a session that was free rather than one that was never priced.
      expect(read.reportedUsage?.costUsd).toBeNull();
      expect(read.parseStats.unparsed).toBe(0);
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("only claims support after reading a real session", () =>
    Effect.gen(function* () {
      const detection = yield* gooseSourceAdapter.detect();

      expect(detection.rootPath).toBe(GOOSE_HOME);
      expect(detection.supported).toBe(true);
      expect(detection.unsupportedReason).toBeNull();
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("reports an absent database as not installed", () =>
    Effect.gen(function* () {
      const detection = yield* gooseSourceAdapter.detect();

      expect(detection.supported).toBe(false);
      expect(detection.unsupportedReason).toBe("not-installed");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          testPlatformLayer({ sourceRoots: { goose: "/nonexistent/goose" } }),
          NodeContext.layer,
        ),
      ),
    ),
  );

  it.live("declines to classify a change, and says so in its capabilities", () =>
    Effect.gen(function* () {
      const roots = yield* gooseSourceAdapter.roots();

      // Everything is in one database, so a changed path names no session. The
      // watcher turns whatever comes back into a project id, so answering at
      // all would mint one no project has.
      expect(
        gooseSourceAdapter.classifyChange(`${roots.at(0) ?? ""}/sessions/sessions.db`, roots),
      ).toBeNull();
      expect(gooseSourceAdapter.capabilities.watch).toBe(false);
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("refuses a session asked for under the wrong workspace", () =>
    Effect.gen(function* () {
      const project = yield* theProject;
      const ref = (yield* gooseSourceAdapter.listSessions(project)).at(0);
      if (ref === undefined) throw new Error("fixture session missing");

      const resolved = yield* gooseSourceAdapter.resolveSessionRef(
        project.storagePath,
        ref.sessionId,
      );
      expect(resolved.sourceSessionKey).toBe(ref.sessionId);

      const wrong = yield* gooseSourceAdapter
        .resolveSessionRef(`${GOOSE_HOME}/#projects/dead`, ref.sessionId)
        .pipe(Effect.flip);
      expect(wrong._tag).toBe("SourceSessionGoneError");
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("ingests into the same tables Claude Code sessions land in", () =>
    Effect.gen(function* () {
      const syncService = yield* SyncService;
      const { db } = yield* DrizzleService;

      yield* syncService.fullSync();

      const projectRows = db.select().from(projects).all();
      const sessionRows = db.select().from(sessions).all();

      expect(projectRows.every((row) => row.source === "goose")).toBe(true);
      expect(projectRows[0]?.canonicalPath).toBe("/work");
      expect(sessionRows).toHaveLength(4);
    }).pipe(Effect.provide(SyncService.Live), Effect.provide(syncLayer)),
  );

  it.live("opens a synced session through the repositories that serve the API", () =>
    Effect.gen(function* () {
      const syncService = yield* SyncService;
      const sessionRepository = yield* SessionRepository;
      const locator = yield* SessionLocatorService;
      const { db } = yield* DrizzleService;

      yield* syncService.fullSync();

      const row = db.select().from(sessions).all().at(0);
      if (row === undefined) throw new Error("sync produced no sessions");

      const { session } = yield* sessionRepository.getSession(row.projectId, row.id);
      expect(session?.conversations.length).toBeGreaterThan(0);

      const location = yield* locator.locate(row.projectId, row.id);
      // Lantern only ever reads another CLI's history.
      expect(location.deletable).toBe(false);
    }).pipe(Effect.provide(readPathLayer)),
  );
});

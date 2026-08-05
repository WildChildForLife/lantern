import { NodeContext } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { describe, expect } from "vitest";
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
import { codexSourceAdapter } from "./CodexSourceAdapter.ts";

const CODEX_HOME = `${process.cwd()}/fixtures/codex-home`;

/** Codepoint order, so an upper-case first letter sorts predictably. */
const byCodePoint = (a: string | null, b: string | null): number => {
  const left = a ?? "";
  const right = b ?? "";
  return left < right ? -1 : left > right ? 1 : 0;
};

// Run as macOS. The fixture's third workspace records its cwd as
// `/home/demo/Notes`, and only a canonicalisation told the filesystem is
// case-insensitive folds it — so a call that omits the platform options gets a
// different answer from the listing and matches nothing.
const platformLayer = testPlatformLayer({
  sourceRoots: { codex: CODEX_HOME },
  env: { HOME: "/home/demo" },
  platform: "darwin",
});

const adapterLayer = Layer.mergeAll(platformLayer, NodeContext.layer);

const syncLayer = Layer.mergeAll(
  makeDrizzleTestServiceLayer(),
  platformLayer,
  NodeContext.layer,
  SourceRegistry.withAdapters([codexSourceAdapter]),
);

const metaLayer = Layer.mergeAll(
  Layer.mock(ProjectMetaService, {
    getProjectMeta: () => Effect.succeed({ projectName: null, projectPath: null, sessionCount: 0 }),
    invalidateProject: () => Effect.void,
  }),
  Layer.mock(SessionMetaService, {
    getSessionMeta: () => Effect.succeed(createMockSessionMeta()),
    invalidateSession: () => Effect.void,
  }),
);

/**
 * The whole read path a browser takes: sync the fixture history, then open a
 * project and a session through the repositories that serve the API.
 *
 * Worth the layers. Every guard between an id and a file was written for Claude
 * Code's one directory, and each one of them refuses a Codex path in a way no
 * adapter-level test can see.
 */
const readPathLayer = Layer.mergeAll(
  ProjectRepository.Live,
  SessionRepository.Live.pipe(Layer.provideMerge(SessionLocatorService.Live)),
).pipe(
  Layer.provideMerge(SyncService.Live),
  Layer.provideMerge(metaLayer),
  Layer.provideMerge(syncLayer),
);

describe("codexSourceAdapter", () => {
  it.live("groups date-partitioned sessions into the workspaces they ran in", () =>
    Effect.gen(function* () {
      const found = yield* codexSourceAdapter.listProjects();

      // Case is preserved in what is shown; only the grouping key is folded.
      expect(found.map((project) => project.cwd).toSorted(byCodePoint)).toStrictEqual([
        "/home/demo/Notes",
        "/home/demo/infra",
        "/home/demo/orders-api",
      ]);
      // Codex has no project directory, so the id is a path it will never write.
      expect(found.every((project) => project.storagePath.includes("/#projects/"))).toBe(true);
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("finds a workspace's sessions across the live and archived trees", () =>
    Effect.gen(function* () {
      const found = yield* codexSourceAdapter.listProjects();
      const ordersApi = found.find((project) => project.cwd === "/home/demo/orders-api");
      if (ordersApi === undefined) {
        throw new Error("fixture workspace missing");
      }

      const refs = yield* codexSourceAdapter.listSessions(ordersApi);

      expect(refs).toHaveLength(2);
      expect(refs.some((ref) => ref.filePath.includes("/archived_sessions/"))).toBe(true);
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("only claims support after parsing a real rollout", () =>
    Effect.gen(function* () {
      const detection = yield* codexSourceAdapter.detect();

      expect(detection.rootPath).toBe(CODEX_HOME);
      expect(detection.hasData).toBe(true);
      expect(detection.supported).toBe(true);
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("reports an absent Codex home as not installed", () =>
    Effect.gen(function* () {
      const detection = yield* codexSourceAdapter.detect();

      expect(detection.supported).toBe(false);
      expect(detection.unsupportedReason).toBe("not-installed");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          testPlatformLayer({ sourceRoots: { codex: "/nonexistent/codex" } }),
          NodeContext.layer,
        ),
      ),
    ),
  );

  it.live("ingests into the same tables Claude Code sessions land in", () =>
    Effect.gen(function* () {
      const syncService = yield* SyncService;
      const { db } = yield* DrizzleService;

      yield* syncService.fullSync();

      const projectRows = db.select().from(projects).all();
      const sessionRows = db.select().from(sessions).all();

      expect(projectRows.every((row) => row.source === "codex")).toBe(true);
      expect(projectRows.map((row) => row.name).toSorted(byCodePoint)).toStrictEqual([
        "Notes",
        "infra",
        "orders-api",
      ]);
      expect(sessionRows).toHaveLength(5);

      // Codex reports no token usage Lantern reads yet, so its cost must not be
      // presented as a number.
      expect(sessionRows.every((row) => row.costConfidence === "unknown")).toBe(true);
      expect(sessionRows.every((row) => row.sourceSessionKey !== null)).toBe(true);
    }).pipe(Effect.provide(SyncService.Live), Effect.provide(syncLayer)),
  );

  it.live("keeps one workspace on one project id across syncs", () =>
    Effect.gen(function* () {
      const syncService = yield* SyncService;
      const { db } = yield* DrizzleService;

      yield* syncService.fullSync();
      const first = db
        .select()
        .from(projects)
        .all()
        .map((row) => row.id)
        .sort((a, b) => a.localeCompare(b));

      yield* syncService.fullSync();
      const second = db
        .select()
        .from(projects)
        .all()
        .map((row) => row.id)
        .sort((a, b) => a.localeCompare(b));

      expect(second).toStrictEqual(first);
    }).pipe(Effect.provide(SyncService.Live), Effect.provide(syncLayer)),
  );

  it.live("opens a synced session through the repositories that serve the API", () =>
    Effect.gen(function* () {
      const syncService = yield* SyncService;
      const sessionRepository = yield* SessionRepository;
      const projectRepository = yield* ProjectRepository;
      const { db } = yield* DrizzleService;

      yield* syncService.fullSync();

      const row = db.select().from(sessions).all().at(0);
      if (row === undefined) {
        throw new Error("sync produced no sessions");
      }

      // The project id decodes to a path under the Codex root that no directory
      // occupies, so every guard on the way has to accept it without stat'ing it.
      const { project } = yield* projectRepository.getProject(row.projectId);
      expect(project.id).toBe(row.projectId);

      const { sessions: listed } = yield* sessionRepository.getSessions(row.projectId);
      expect(listed.map((session) => session.id)).toContain(row.id);

      const { session } = yield* sessionRepository.getSession(row.projectId, row.id);
      expect(session).not.toBeNull();
      expect(session?.conversations.length).toBeGreaterThan(0);
    }).pipe(Effect.provide(readPathLayer)),
  );

  it.live("refuses to open a session under a project it did not run in", () =>
    Effect.gen(function* () {
      const syncService = yield* SyncService;
      const sessionRepository = yield* SessionRepository;
      const { db } = yield* DrizzleService;

      yield* syncService.fullSync();

      const rows = db.select().from(sessions).all();
      const session = rows.at(0);
      const foreign = rows.find((row) => row.projectId !== session?.projectId);
      if (session === undefined || foreign === undefined) {
        throw new Error("fixture needs two workspaces");
      }

      // The session id is real and the project id is real; they just do not go
      // together. Answering anyway would let one workspace's history be read
      // through another's id.
      const { session: opened } = yield* sessionRepository.getSession(
        foreign.projectId,
        session.id,
      );

      expect(opened).toBeNull();
    }).pipe(Effect.provide(readPathLayer)),
  );

  it.live("still finds a session whose metadata line is larger than the read window", () =>
    Effect.gen(function* () {
      const found = yield* codexSourceAdapter.listProjects();
      const infra = found.find((project) => project.cwd === "/home/demo/infra");
      if (infra === undefined) {
        throw new Error("fixture workspace missing");
      }

      const refs = yield* codexSourceAdapter.listSessions(infra);

      // One fixture session carries a 20 KB `instructions` payload, so its
      // `session_meta` does not fit the window the listing reads. Dropping the
      // tail of that window would leave nothing at all, and the session would
      // be missing from every listing with nothing to say why.
      expect(refs.map((ref) => ref.sessionId)).toContain("0199a3f1-7c22-7d44-b8e5-3a1c9f2b6e08");
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("keeps a project's timestamp when a single session is re-synced", () =>
    Effect.gen(function* () {
      const syncService = yield* SyncService;
      const { db } = yield* DrizzleService;

      yield* syncService.fullSync();

      const row = db.select().from(sessions).all().at(0);
      if (row === undefined) {
        throw new Error("sync produced no sessions");
      }

      const before = db.select().from(projects).where(eq(projects.id, row.projectId)).get();
      expect(before?.dirMtimeMs).toBeGreaterThan(0);

      // The cached mtime has to be stale or the sync returns without writing
      // anything, and the test would pass whatever the write does.
      db.update(sessions).set({ fileMtimeMs: 0 }).where(eq(sessions.id, row.id)).run();
      yield* syncService.syncSession(row.projectId, row.id);

      const after = db.select().from(projects).where(eq(projects.id, row.projectId)).get();

      // A single-session sync stats the project's storage path, which for a
      // date-partitioned source is one the CLI never creates. Writing the
      // failed stat's zero would date the project to 1970 and sink it to the
      // bottom of every list.
      expect(after?.dirMtimeMs).toBeGreaterThan(0);
    }).pipe(Effect.provide(SyncService.Live), Effect.provide(syncLayer)),
  );

  it.live("locates a Codex session's file and refuses to delete it", () =>
    Effect.gen(function* () {
      const syncService = yield* SyncService;
      const locator = yield* SessionLocatorService;
      const { db } = yield* DrizzleService;

      yield* syncService.fullSync();

      const row = db.select().from(sessions).all().at(0);
      if (row === undefined) {
        throw new Error("sync produced no sessions");
      }

      // The locator validates a cached path against the roots of the source
      // that owns it. A source declaring none — which an unwatched one used to
      // — makes every one of its sessions unreachable.
      const location = yield* locator.locate(row.projectId, row.id);

      expect(location.filePath).toBe(row.filePath);
      expect(location.sourceId).toBe("codex");
      // Lantern only ever reads another CLI's history.
      expect(location.deletable).toBe(false);
    }).pipe(Effect.provide(readPathLayer)),
  );

  it.live("records the model each turn actually ran on", () =>
    Effect.gen(function* () {
      const found = yield* codexSourceAdapter.listProjects();
      const notes = found.find((project) => project.cwd === "/home/demo/Notes");
      if (notes === undefined) {
        throw new Error("fixture workspace missing");
      }

      const refs = yield* codexSourceAdapter.listSessions(notes);
      const ref = refs.at(0);
      if (ref === undefined) {
        throw new Error("fixture session missing");
      }

      const read = yield* codexSourceAdapter.readSession(ref);
      const models = read.entries
        .filter((entry) => entry.type === "assistant")
        .map((entry) => entry.message.model);

      // The fixture switches model mid-file. Reading the running value when the
      // entries are built instead of when the line was seen would stamp every
      // one of them with the last.
      expect(models).toStrictEqual(["gpt-5-codex-mini", "gpt-5-codex-mini", "gpt-5-codex"]);
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("counts kinds it does not render as ignored, never as unreadable", () =>
    Effect.gen(function* () {
      const found = yield* codexSourceAdapter.listProjects();
      const notes = found.find((project) => project.cwd === "/home/demo/Notes");
      if (notes === undefined) {
        throw new Error("fixture workspace missing");
      }

      const refs = yield* codexSourceAdapter.listSessions(notes);
      const ref = refs.at(0);
      if (ref === undefined) {
        throw new Error("fixture session missing");
      }

      const read = yield* codexSourceAdapter.readSession(ref);

      // The fixture holds a `web_search_call`, which Lantern skips by choice.
      // Counting it as unreadable would mean the unparsed count no longer says
      // anything about whether the format moved.
      expect(read.parseStats.unparsed).toBe(0);
      expect(read.parseStats.ignored).toBeGreaterThan(0);
    }).pipe(Effect.provide(adapterLayer)),
  );
});

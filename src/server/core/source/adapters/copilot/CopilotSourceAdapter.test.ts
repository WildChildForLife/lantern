import { NodeContext } from "@effect/platform-node";
import { it } from "@effect/vitest";
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
import { copilotSourceAdapter } from "./CopilotSourceAdapter.ts";

const COPILOT_HOME = `${process.cwd()}/fixtures/copilot-home`;

const platformLayer = testPlatformLayer({
  sourceRoots: { copilot: COPILOT_HOME },
  env: { HOME: "/home/demo" },
});

const adapterLayer = Layer.mergeAll(platformLayer, NodeContext.layer);

const syncLayer = Layer.mergeAll(
  makeDrizzleTestServiceLayer(),
  platformLayer,
  NodeContext.layer,
  SourceRegistry.withAdapters([copilotSourceAdapter]),
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

const readPathLayer = Layer.mergeAll(
  ProjectRepository.Live,
  SessionRepository.Live.pipe(Layer.provideMerge(SessionLocatorService.Live)),
).pipe(
  Layer.provideMerge(SyncService.Live),
  Layer.provideMerge(metaLayer),
  Layer.provideMerge(syncLayer),
);

const theProject = Effect.gen(function* () {
  const found = yield* copilotSourceAdapter.listProjects();
  const project = found.at(0);
  if (project === undefined) {
    throw new Error("fixture workspace missing");
  }

  return project;
});

describe("copilotSourceAdapter", () => {
  it.live("groups every session by the workspace its opening event names", () =>
    Effect.gen(function* () {
      const found = yield* copilotSourceAdapter.listProjects();

      // Copilot files sessions flat under session-state/, so a project is a
      // grouping rather than a directory. All four ran in /work.
      expect(found).toHaveLength(1);
      expect(found[0]?.cwd).toBe("/work");
      expect(found[0]?.storagePath).toContain("#projects/");
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("lists every session in the workspace", () =>
    Effect.gen(function* () {
      const refs = yield* copilotSourceAdapter.listSessions(yield* theProject);

      expect(refs).toHaveLength(4);
      expect(refs.every((ref) => ref.filePath.endsWith("/events.jsonl"))).toBe(true);
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("reads a session with its reasoning, tool calls and reported tokens", () =>
    Effect.gen(function* () {
      const refs = yield* copilotSourceAdapter.listSessions(yield* theProject);
      const ref = refs.find((candidate) => candidate.sessionId.startsWith("049410b4"));
      if (ref === undefined) {
        throw new Error("fixture session missing");
      }

      const read = yield* copilotSourceAdapter.readSession(ref);

      expect(read.parseStats.unparsed).toBe(0);
      expect(read.entries).toHaveLength(8);
      expect(read.reportedUsage?.inputTokens).toBe(4100);
      // Tokens are recorded; a price is not, and inventing one would be a lie.
      expect(read.reportedUsage?.costUsd).toBeNull();
      // Nothing to scan — the CLI counted for itself.
      expect(read.usageTexts).toStrictEqual([]);
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("only claims support after parsing a real session", () =>
    Effect.gen(function* () {
      const detection = yield* copilotSourceAdapter.detect();

      expect(detection.rootPath).toBe(COPILOT_HOME);
      expect(detection.hasData).toBe(true);
      expect(detection.supported).toBe(true);
      expect(detection.unsupportedReason).toBeNull();
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("reports an absent copilot directory as not installed", () =>
    Effect.gen(function* () {
      const detection = yield* copilotSourceAdapter.detect();

      expect(detection.supported).toBe(false);
      expect(detection.unsupportedReason).toBe("not-installed");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          testPlatformLayer({ sourceRoots: { copilot: "/nonexistent/copilot" } }),
          NodeContext.layer,
        ),
      ),
    ),
  );

  it.live("resolves a session by id, and refuses one from another workspace", () =>
    Effect.gen(function* () {
      const project = yield* theProject;
      const refs = yield* copilotSourceAdapter.listSessions(project);
      const first = refs[0];
      if (first === undefined) {
        throw new Error("fixture session missing");
      }

      const resolved = yield* copilotSourceAdapter.resolveSessionRef(
        project.storagePath,
        first.sessionId,
      );
      expect(resolved.filePath).toBe(first.filePath);

      const gone = yield* copilotSourceAdapter
        .resolveSessionRef(project.storagePath, "no-such-session")
        .pipe(Effect.flip);
      expect(gone._tag).toBe("SourceSessionGoneError");

      // A real session asked for under the wrong project is not this project's
      // to return — the id alone would otherwise reach any session on disk.
      const wrongProject = yield* copilotSourceAdapter
        .resolveSessionRef(`${COPILOT_HOME}/#projects/deadbeefdeadbeef`, first.sessionId)
        .pipe(Effect.flip);
      expect(wrongProject._tag).toBe("SourceSessionGoneError");
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("maps a changed event log to the session it names, without reading it", () =>
    Effect.gen(function* () {
      const roots = yield* copilotSourceAdapter.roots();
      const root = roots.at(0);
      if (root === undefined) {
        throw new Error("adapter declared no roots");
      }

      const change = copilotSourceAdapter.classifyChange(
        `${root}/session-state/abc/events.jsonl`,
        roots,
      );
      expect(change?.sessionId).toBe("abc");

      // A path outside the tree is none of this source's business, and neither
      // is the SQLite index or a session's own checkpoint database.
      expect(copilotSourceAdapter.classifyChange("/etc/passwd", roots)).toBeNull();
      expect(copilotSourceAdapter.classifyChange(`${root}/session-store.db`, roots)).toBeNull();
      expect(
        copilotSourceAdapter.classifyChange(`${root}/session-state/abc/session.db`, roots),
      ).toBeNull();
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("ingests into the same tables Claude Code sessions land in", () =>
    Effect.gen(function* () {
      const syncService = yield* SyncService;
      const { db } = yield* DrizzleService;

      yield* syncService.fullSync();

      const projectRows = db.select().from(projects).all();
      const sessionRows = db.select().from(sessions).all();

      expect(projectRows.every((row) => row.source === "copilot")).toBe(true);
      expect(projectRows[0]?.canonicalPath).toBe("/work");
      expect(sessionRows).toHaveLength(4);

      // Copilot counts tokens but prices nothing, so no cost is stored.
      expect(sessionRows.every((row) => row.nativeCostUsd === null)).toBe(true);
    }).pipe(Effect.provide(SyncService.Live), Effect.provide(syncLayer)),
  );

  it.live("opens a synced session through the repositories that serve the API", () =>
    Effect.gen(function* () {
      const syncService = yield* SyncService;
      const sessionRepository = yield* SessionRepository;
      const projectRepository = yield* ProjectRepository;
      const locator = yield* SessionLocatorService;
      const { db } = yield* DrizzleService;

      yield* syncService.fullSync();

      const row = db.select().from(sessions).all().at(0);
      if (row === undefined) {
        throw new Error("sync produced no sessions");
      }

      const { project } = yield* projectRepository.getProject(row.projectId);
      expect(project.id).toBe(row.projectId);

      const { session } = yield* sessionRepository.getSession(row.projectId, row.id);
      expect(session?.conversations.length).toBeGreaterThan(0);

      const location = yield* locator.locate(row.projectId, row.id);
      // Lantern only ever reads another CLI's history.
      expect(location.deletable).toBe(false);
    }).pipe(Effect.provide(readPathLayer)),
  );
});

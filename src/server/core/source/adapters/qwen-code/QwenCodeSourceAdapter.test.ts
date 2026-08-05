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
import { qwenCodeSourceAdapter } from "./QwenCodeSourceAdapter.ts";

const QWEN_HOME = `${process.cwd()}/fixtures/qwen-home`;

const platformLayer = testPlatformLayer({
  sourceRoots: { "qwen-code": QWEN_HOME },
  env: { HOME: "/home/demo" },
});

const adapterLayer = Layer.mergeAll(platformLayer, NodeContext.layer);

const syncLayer = Layer.mergeAll(
  makeDrizzleTestServiceLayer(),
  platformLayer,
  NodeContext.layer,
  SourceRegistry.withAdapters([qwenCodeSourceAdapter]),
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
  const found = yield* qwenCodeSourceAdapter.listProjects();
  const project = found.at(0);
  if (project === undefined) {
    throw new Error("fixture workspace missing");
  }

  return project;
});

describe("qwenCodeSourceAdapter", () => {
  it.live("takes the chats directory of each project as the project", () =>
    Effect.gen(function* () {
      const found = yield* qwenCodeSourceAdapter.listProjects();

      expect(found).toHaveLength(1);
      expect(found[0]?.sourceProjectKey).toBe("-work");
      expect(found[0]?.storagePath).toBe(`${QWEN_HOME}/projects/-work/chats`);
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("resolves the working directory from a transcript, not the directory name", () =>
    Effect.gen(function* () {
      const project = yield* theProject;

      // `-work` is a lossy encoding of `/work`: a directory whose own name
      // contains a dash is indistinguishable from a separator, so it is never
      // decoded. The record says.
      expect(project.cwd).toBeNull();
      expect(yield* qwenCodeSourceAdapter.resolveProjectCwd(project)).toBe("/work");
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("lists every session in the project", () =>
    Effect.gen(function* () {
      const refs = yield* qwenCodeSourceAdapter.listSessions(yield* theProject);

      expect(refs).toHaveLength(4);
      expect(refs.every((ref) => ref.filePath.endsWith(".jsonl"))).toBe(true);
      expect(refs.every((ref) => ref.sessionId === ref.sourceSessionKey)).toBe(true);
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("reads a session with its reasoning, tool calls and reported tokens", () =>
    Effect.gen(function* () {
      const refs = yield* qwenCodeSourceAdapter.listSessions(yield* theProject);
      const ref = refs.find((candidate) => candidate.sessionId.startsWith("c190cd9d"));
      if (ref === undefined) {
        throw new Error("fixture session missing");
      }

      const read = yield* qwenCodeSourceAdapter.readSession(ref);

      expect(read.parseStats.unparsed).toBe(0);
      expect(read.entries.length).toBeGreaterThan(0);
      expect(read.reportedUsage?.inputTokens).toBe(8200);
      // Tokens are recorded; prices are not, and inventing one would be a lie.
      expect(read.reportedUsage?.costUsd).toBeNull();
      // Nothing to scan — the CLI counted for itself.
      expect(read.usageTexts).toStrictEqual([]);
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("only claims support after parsing a real session", () =>
    Effect.gen(function* () {
      const detection = yield* qwenCodeSourceAdapter.detect();

      expect(detection.rootPath).toBe(QWEN_HOME);
      expect(detection.hasData).toBe(true);
      expect(detection.supported).toBe(true);
      expect(detection.unsupportedReason).toBeNull();
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("reports an absent qwen directory as not installed", () =>
    Effect.gen(function* () {
      const detection = yield* qwenCodeSourceAdapter.detect();

      expect(detection.supported).toBe(false);
      expect(detection.unsupportedReason).toBe("not-installed");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          testPlatformLayer({ sourceRoots: { "qwen-code": "/nonexistent/qwen" } }),
          NodeContext.layer,
        ),
      ),
    ),
  );

  it.live("resolves a session by id, and reports a vanished one as gone", () =>
    Effect.gen(function* () {
      const project = yield* theProject;
      const refs = yield* qwenCodeSourceAdapter.listSessions(project);
      const first = refs[0];
      if (first === undefined) {
        throw new Error("fixture session missing");
      }

      const resolved = yield* qwenCodeSourceAdapter.resolveSessionRef(
        project.storagePath,
        first.sessionId,
      );
      expect(resolved.filePath).toBe(first.filePath);

      const gone = yield* qwenCodeSourceAdapter
        .resolveSessionRef(project.storagePath, "no-such-session")
        .pipe(Effect.flip);
      expect(gone._tag).toBe("SourceSessionGoneError");
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("maps a changed transcript to the session it names, without reading it", () =>
    Effect.gen(function* () {
      const roots = yield* qwenCodeSourceAdapter.roots();
      const root = roots.at(0);
      if (root === undefined) {
        throw new Error("adapter declared no roots");
      }

      const change = qwenCodeSourceAdapter.classifyChange(
        `${root}/projects/-work/chats/abc.jsonl`,
        roots,
      );

      expect(change?.sessionId).toBe("abc");
      expect(change?.projectStoragePath).toBe(`${root}/projects/-work/chats`);

      // A path outside the tree is none of this source's business, and neither
      // is a sibling file that is not a transcript.
      expect(qwenCodeSourceAdapter.classifyChange("/etc/passwd", roots)).toBeNull();
      expect(
        qwenCodeSourceAdapter.classifyChange(`${root}/projects/-work/meta.json`, roots),
      ).toBeNull();
      expect(qwenCodeSourceAdapter.classifyChange(`${root}/usage_record.jsonl`, roots)).toBeNull();
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("ingests into the same tables Claude Code sessions land in", () =>
    Effect.gen(function* () {
      const syncService = yield* SyncService;
      const { db } = yield* DrizzleService;

      yield* syncService.fullSync();

      const projectRows = db.select().from(projects).all();
      const sessionRows = db.select().from(sessions).all();

      expect(projectRows.every((row) => row.source === "qwen-code")).toBe(true);
      expect(projectRows[0]?.canonicalPath).toBe("/work");
      expect(sessionRows).toHaveLength(4);

      // Qwen Code counts tokens but does not price them, so no cost is claimed
      // for a session and none is stored.
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

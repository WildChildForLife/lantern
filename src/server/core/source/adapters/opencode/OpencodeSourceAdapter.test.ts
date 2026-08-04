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
import { opencodeSourceAdapter } from "./OpencodeSourceAdapter.ts";

const OPENCODE_HOME = `${process.cwd()}/fixtures/opencode-home`;

const platformLayer = testPlatformLayer({
  sourceRoots: { opencode: OPENCODE_HOME },
  env: { HOME: "/home/demo" },
});

const adapterLayer = Layer.mergeAll(platformLayer, NodeContext.layer);

const syncLayer = Layer.mergeAll(
  makeDrizzleTestServiceLayer(),
  platformLayer,
  NodeContext.layer,
  SourceRegistry.withAdapters([opencodeSourceAdapter]),
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

const findSession = Effect.gen(function* () {
  const found = yield* opencodeSourceAdapter.listProjects();
  const orders = found.find((project) => project.cwd === "/home/demo/orders-api");
  if (orders === undefined) {
    throw new Error("fixture workspace missing");
  }

  const refs = yield* opencodeSourceAdapter.listSessions(orders);
  const ref = refs.at(0);
  if (ref === undefined) {
    throw new Error("fixture session missing");
  }

  return yield* opencodeSourceAdapter.readSession(ref);
});

/** The content block types of one entry, whatever shape its message takes. */
const contentTypes = (entry: { readonly type: string }): string[] => {
  if (!("message" in entry) || typeof entry.message !== "object" || entry.message === null) {
    return [];
  }
  if (!("content" in entry.message)) {
    return [];
  }

  const content = entry.message.content;
  if (typeof content === "string") return ["text"];
  if (!Array.isArray(content)) return [];

  return content.flatMap((part: unknown) =>
    typeof part === "object" && part !== null && "type" in part && typeof part.type === "string"
      ? [part.type]
      : [],
  );
};

/** The `id`/`tool_use_id` of every content block of one type. */
const idsOfType = (entry: { readonly type: string }, blockType: string, key: string): string[] => {
  if (!("message" in entry) || typeof entry.message !== "object" || entry.message === null) {
    return [];
  }
  if (!("content" in entry.message)) return [];

  const content = entry.message.content;
  if (!Array.isArray(content)) return [];

  return content.flatMap((part: unknown) => {
    if (typeof part !== "object" || part === null) return [];
    if (!("type" in part) || part.type !== blockType) return [];
    if (!(key in part)) return [];

    const value: unknown = Reflect.get(part, key);
    return typeof value === "string" ? [value] : [];
  });
};

/** Codepoint order, so a path's case sorts predictably. */
const byCodePoint = (a: string | null, b: string | null): number => {
  const left = a ?? "";
  const right = b ?? "";
  return left < right ? -1 : left > right ? 1 : 0;
};

describe("opencodeSourceAdapter", () => {
  it.live("reads a workspace from the project file its session directory is named for", () =>
    Effect.gen(function* () {
      const found = yield* opencodeSourceAdapter.listProjects();

      expect(found.map((project) => project.cwd).toSorted(byCodePoint)).toStrictEqual([
        "/home/demo/infra",
        "/home/demo/orders-api",
      ]);
      // opencode keeps a real directory per project, so the id is an ordinary
      // path rather than one Lantern has to invent.
      expect(found.every((project) => project.storagePath.includes("/storage/session/"))).toBe(
        true,
      );
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("turns one assistant message into the parts of a turn", () =>
    Effect.gen(function* () {
      const read = yield* findSession;

      // One opencode message holds reasoning, a tool call and the reply. Each
      // becomes its own entry, and the tool call gains the result the viewer
      // threads onto it.
      const kinds = read.entries.flatMap(contentTypes);

      expect(kinds).toContain("thinking");
      expect(kinds).toContain("tool_use");
      expect(kinds).toContain("tool_result");
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("pairs a tool result with the call it belongs to", () =>
    Effect.gen(function* () {
      const read = yield* findSession;

      const callIds = read.entries.flatMap((entry) => idsOfType(entry, "tool_use", "id"));
      const resultIds = read.entries.flatMap((entry) =>
        idsOfType(entry, "tool_result", "tool_use_id"),
      );

      // An unpaired result renders as an orphan block, so the ids have to match
      // rather than merely both being present.
      expect(resultIds).toContain("tool_1");
      expect(callIds).toContain("tool_1");
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("counts scaffolding as ignored and a corrupt file as unreadable", () =>
    Effect.gen(function* () {
      const read = yield* findSession;

      // The fixture holds a `system` and a `model-switched` message, which are
      // not conversation, and one truncated file, which is a message Lantern
      // failed to read. Folding those together would mean the unparsed count
      // no longer says whether the format moved.
      expect(read.parseStats.ignored).toBeGreaterThanOrEqual(2);
      expect(read.parseStats.unparsed).toBe(1);
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("takes the cost opencode recorded rather than pricing it again", () =>
    Effect.gen(function* () {
      const read = yield* findSession;

      // opencode bills against providers Lantern has no price table for, so a
      // recomputed number would be wrong wherever it was not zero.
      expect(read.reportedUsage?.costUsd).toBeCloseTo(0.0412, 6);
      expect(read.reportedUsage?.inputTokens).toBe(5120);
      expect(read.reportedUsage?.cacheReadTokens).toBe(4096);
      expect(read.usageTexts).toStrictEqual([]);
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("only claims support after parsing a real session", () =>
    Effect.gen(function* () {
      const detection = yield* opencodeSourceAdapter.detect();

      expect(detection.rootPath).toBe(OPENCODE_HOME);
      expect(detection.hasData).toBe(true);
      expect(detection.supported).toBe(true);
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("reports an absent opencode directory as not installed", () =>
    Effect.gen(function* () {
      const detection = yield* opencodeSourceAdapter.detect();

      expect(detection.supported).toBe(false);
      expect(detection.unsupportedReason).toBe("not-installed");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          testPlatformLayer({ sourceRoots: { opencode: "/nonexistent/opencode" } }),
          NodeContext.layer,
        ),
      ),
    ),
  );

  it.live("maps a changed session file to the session it names, without reading it", () =>
    Effect.gen(function* () {
      const roots = yield* opencodeSourceAdapter.roots();
      const root = roots.at(0);
      if (root === undefined) {
        throw new Error("adapter declared no roots");
      }

      const change = opencodeSourceAdapter.classifyChange(
        `${root}/storage/session/prj_orders/ses_01.json`,
        roots,
      );

      expect(change?.sessionId).toBe("ses_01");
      expect(change?.projectStoragePath).toBe(`${root}/storage/session/prj_orders`);
      // A path outside the tree is none of this source's business.
      expect(opencodeSourceAdapter.classifyChange("/etc/passwd", roots)).toBeNull();
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.live("ingests into the same tables Claude Code sessions land in", () =>
    Effect.gen(function* () {
      const syncService = yield* SyncService;
      const { db } = yield* DrizzleService;

      yield* syncService.fullSync();

      const projectRows = db.select().from(projects).all();
      const sessionRows = db.select().from(sessions).all();

      expect(projectRows.every((row) => row.source === "opencode")).toBe(true);
      expect(sessionRows).toHaveLength(2);

      // The cost came from opencode, so it is reported rather than estimated
      // and is kept as the source's own number too.
      expect(sessionRows.every((row) => row.costConfidence === "reported")).toBe(true);
      expect(sessionRows.every((row) => row.nativeCostUsd !== null)).toBe(true);
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

      const { sessions: listed } = yield* sessionRepository.getSessions(row.projectId);
      expect(listed.map((session) => session.id)).toContain(row.id);

      const { session } = yield* sessionRepository.getSession(row.projectId, row.id);
      expect(session?.conversations.length).toBeGreaterThan(0);

      const location = yield* locator.locate(row.projectId, row.id);
      // Lantern only ever reads another CLI's history.
      expect(location.deletable).toBe(false);
    }).pipe(Effect.provide(readPathLayer)),
  );
});

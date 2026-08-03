import { NodeContext } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe, expect } from "vitest";
import { makeDrizzleTestServiceLayer } from "../../../../../testing/layers/testDrizzleServiceLayer.ts";
import { testPlatformLayer } from "../../../../../testing/layers/testPlatformLayer.ts";
import { DrizzleService } from "../../../../lib/db/DrizzleService.ts";
import { projects, sessions } from "../../../../lib/db/schema.ts";
import { SyncService } from "../../../sync/services/SyncService.ts";
import { SourceRegistry } from "../../services/SourceRegistry.ts";
import { codexSourceAdapter } from "./CodexSourceAdapter.ts";

const CODEX_HOME = `${process.cwd()}/fixtures/codex-home`;

const platformLayer = testPlatformLayer({ sourceRoots: { codex: CODEX_HOME } });

const adapterLayer = Layer.mergeAll(platformLayer, NodeContext.layer);

const syncLayer = Layer.mergeAll(
  makeDrizzleTestServiceLayer(),
  platformLayer,
  NodeContext.layer,
  SourceRegistry.withAdapters([codexSourceAdapter]),
);

describe("codexSourceAdapter", () => {
  it.live("groups date-partitioned sessions into the workspaces they ran in", () =>
    Effect.gen(function* () {
      const found = yield* codexSourceAdapter.listProjects();

      expect(
        found.map((project) => project.cwd).sort((a, b) => (a ?? "").localeCompare(b ?? "")),
      ).toStrictEqual(["/home/demo/infra", "/home/demo/orders-api"]);
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
      expect(
        projectRows.map((row) => row.name).sort((a, b) => (a ?? "").localeCompare(b ?? "")),
      ).toStrictEqual(["infra", "orders-api"]);
      expect(sessionRows).toHaveLength(3);

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
});

import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe, expect } from "vitest";
import { makeDrizzleTestServiceLayer } from "../../../../testing/layers/testDrizzleServiceLayer.ts";
import { testPlatformLayer } from "../../../../testing/layers/testPlatformLayer.ts";
import { DrizzleService } from "../../../lib/db/DrizzleService.ts";
import { projects, sessions } from "../../../lib/db/schema.ts";
import { decodeProjectId } from "../../project/functions/id.ts";
import { ALL_SOURCE_ADAPTERS, SourceRegistry } from "../../source/services/SourceRegistry.ts";
import { SyncService } from "./SyncService.ts";

/**
 * Golden test for the ingestion engine.
 *
 * It exists to make "pure refactor, no behaviour change" checkable rather than
 * asserted: the snapshot covers every content-derived column `fullSync` writes
 * for the whole fixture tree, so a dropped field shows up as a diff instead of
 * as a bug months later. Anything derived from the clock or from file mtimes is
 * replaced with a placeholder — those differ per checkout and say nothing about
 * behaviour.
 */

/** Absolute paths differ per machine; express them relative to the repo root. */
const relativeToRepo = (absolutePath: string): string =>
  absolutePath.startsWith(process.cwd())
    ? `<repo>${absolutePath.slice(process.cwd().length)}`
    : absolutePath;

const testLayer = Layer.mergeAll(
  makeDrizzleTestServiceLayer(),
  // Pinned, because canonicalPath is case-folded on case-insensitive
  // filesystems and this test snapshots it. Left to the host, the same snapshot
  // records /path/to/Demo on Linux and /path/to/demo on macOS, so the suite
  // could only ever pass on one of them.
  testPlatformLayer({ platform: "linux" }),
  NodeFileSystem.layer,
  SourceRegistry.withAdapters(ALL_SOURCE_ADAPTERS),
);

describe("SyncService.fullSync", () => {
  it.live("ingests the fixture Claude home into projects, sessions and the search index", () =>
    Effect.gen(function* () {
      const syncService = yield* SyncService;
      const { db, rawDb } = yield* DrizzleService;

      yield* syncService.fullSync();

      const projectRows = db
        .select()
        .from(projects)
        .all()
        .map((row) => ({
          // The id is base64url of an absolute path — decode it so the snapshot
          // stays readable and machine independent.
          storagePath: relativeToRepo(decodeProjectId(row.id)),
          name: row.name,
          path: row.path,
          source: row.source,
          sourceProjectKey: row.sourceProjectKey,
          canonicalPath: row.canonicalPath,
          sessionCount: row.sessionCount,
        }))
        .sort((a, b) => a.storagePath.localeCompare(b.storagePath));

      const sessionRows = db
        .select()
        .from(sessions)
        .all()
        .map((row) => ({
          id: row.id,
          projectStoragePath: relativeToRepo(decodeProjectId(row.projectId)),
          source: row.source,
          sourceSessionKey: row.sourceSessionKey,
          filePath: relativeToRepo(row.filePath),
          messageCount: row.messageCount,
          firstUserMessageJson: row.firstUserMessageJson,
          customTitle: row.customTitle,
          totalCostUsd: row.totalCostUsd,
          costBreakdownJson: row.costBreakdownJson,
          tokenUsageJson: row.tokenUsageJson,
          modelName: row.modelName,
          costConfidence: row.costConfidence,
          prLinksJson: row.prLinksJson,
          permissionAllowlistJson: row.permissionAllowlistJson,
          ftsRowCount: Number(
            rawDb
              .prepare("SELECT COUNT(*) AS c FROM session_messages_fts WHERE session_id = ?")
              .get(row.id)?.c ?? -1,
          ),
        }))
        .sort((a, b) => a.id.localeCompare(b.id));

      expect({ projectRows, sessionRows }).toMatchSnapshot();
    }).pipe(Effect.provide(SyncService.Live), Effect.provide(testLayer)),
  );

  it.live("is idempotent — a second run changes nothing", () =>
    Effect.gen(function* () {
      const syncService = yield* SyncService;
      const { db } = yield* DrizzleService;

      yield* syncService.fullSync();
      const afterFirst = db.select().from(sessions).all().length;
      const projectsAfterFirst = db.select().from(projects).all().length;

      yield* syncService.fullSync();

      expect(db.select().from(sessions).all().length).toBe(afterFirst);
      expect(db.select().from(projects).all().length).toBe(projectsAfterFirst);
    }).pipe(Effect.provide(SyncService.Live), Effect.provide(testLayer)),
  );

  it.live("indexes searchable content for at least one session", () =>
    Effect.gen(function* () {
      const syncService = yield* SyncService;
      const { rawDb } = yield* DrizzleService;

      yield* syncService.fullSync();

      const total = Number(
        rawDb.prepare("SELECT COUNT(*) AS c FROM session_messages_fts").get()?.c ?? 0,
      );

      expect(total).toBeGreaterThan(0);
    }).pipe(Effect.provide(SyncService.Live), Effect.provide(testLayer)),
  );

  it.live("forgets one source's rows without touching another's", () =>
    Effect.gen(function* () {
      const syncService = yield* SyncService;
      const { db, rawDb } = yield* DrizzleService;

      yield* syncService.fullSync();

      const before = db.select().from(sessions).all().length;
      expect(before).toBeGreaterThan(0);

      yield* syncService.purgeSource("claude-code");

      expect(db.select().from(sessions).all().length).toBe(0);
      expect(db.select().from(projects).all().length).toBe(0);
      // The search index is a virtual table with no foreign keys, so nothing
      // deletes its rows for us.
      expect(
        Number(rawDb.prepare("SELECT COUNT(*) AS c FROM session_messages_fts").get()?.c ?? -1),
      ).toBe(0);
    }).pipe(Effect.provide(SyncService.Live), Effect.provide(testLayer)),
  );

  it.live("re-reads a purged source on the next sync", () =>
    Effect.gen(function* () {
      const syncService = yield* SyncService;
      const { db } = yield* DrizzleService;

      yield* syncService.fullSync();
      const before = db.select().from(sessions).all().length;

      yield* syncService.purgeSource("claude-code");
      yield* syncService.fullSync(["claude-code"]);

      expect(db.select().from(sessions).all().length).toBe(before);
    }).pipe(Effect.provide(SyncService.Live), Effect.provide(testLayer)),
  );
});

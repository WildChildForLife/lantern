import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe, expect } from "vitest";
import { makeDrizzleTestServiceLayer } from "../../../../testing/layers/testDrizzleServiceLayer.ts";
import { testPlatformLayer } from "../../../../testing/layers/testPlatformLayer.ts";
import { DrizzleService } from "../../../lib/db/DrizzleService.ts";
import { projects, sessions } from "../../../lib/db/schema.ts";
import { decodeProjectId } from "../../project/functions/id.ts";
import { SourceRegistry } from "../../source/services/SourceRegistry.ts";
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
  testPlatformLayer(),
  NodeFileSystem.layer,
  SourceRegistry.Live,
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
          filePath: relativeToRepo(row.filePath),
          messageCount: row.messageCount,
          firstUserMessageJson: row.firstUserMessageJson,
          customTitle: row.customTitle,
          totalCostUsd: row.totalCostUsd,
          costBreakdownJson: row.costBreakdownJson,
          tokenUsageJson: row.tokenUsageJson,
          modelName: row.modelName,
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
});

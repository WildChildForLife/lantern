import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe, expect } from "vitest";
import { makeDrizzleTestServiceLayer } from "../../../../testing/layers/testDrizzleServiceLayer.ts";
import { testPlatformLayer } from "../../../../testing/layers/testPlatformLayer.ts";
import type { DrizzleDb } from "../../../lib/db/DrizzleService.ts";
import { projects, sessions } from "../../../lib/db/schema.ts";
import { encodeProjectId } from "../../project/functions/id.ts";
import { ALL_SOURCE_ADAPTERS, SourceRegistry } from "../../source/services/SourceRegistry.ts";
import { SessionLocatorService } from "./SessionLocatorService.ts";

const FIXTURE_PROJECT = `${process.cwd()}/fixtures/claude-home/projects/-home-demo-orders-api`;
const PROJECT_ID = encodeProjectId(FIXTURE_PROJECT);

const seedSession =
  (options: { id: string; filePath: string; source: string }) => (db: DrizzleDb) => {
    db.insert(projects).values({ id: PROJECT_ID, dirMtimeMs: 0, syncedAt: 0 }).run();
    db.insert(sessions)
      .values({
        id: options.id,
        projectId: PROJECT_ID,
        filePath: options.filePath,
        source: options.source,
        fileMtimeMs: 0,
        lastModifiedAt: new Date(0).toISOString(),
        syncedAt: 0,
      })
      .run();
  };

const layerFor = (seed: (db: DrizzleDb) => void) =>
  Layer.mergeAll(
    makeDrizzleTestServiceLayer(seed),
    testPlatformLayer(),
    NodeFileSystem.layer,
    SourceRegistry.withAdapters(ALL_SOURCE_ADAPTERS),
  );

describe("SessionLocatorService", () => {
  it.live("resolves a cached session to its file", () =>
    Effect.gen(function* () {
      const locator = yield* SessionLocatorService;

      const location = yield* locator.locate(PROJECT_ID, "known-session");

      expect(location.filePath).toBe(`${FIXTURE_PROJECT}/known-session.jsonl`);
      expect(location.sourceId).toBe("claude-code");
      expect(location.deletable).toBe(true);
    }).pipe(
      Effect.provide(SessionLocatorService.Live),
      Effect.provide(
        layerFor(
          seedSession({
            id: "known-session",
            filePath: `${FIXTURE_PROJECT}/known-session.jsonl`,
            source: "claude-code",
          }),
        ),
      ),
    ),
  );

  /**
   * The cached path is the authority now, so a row pointing outside its source's
   * roots — however it got there — must not be handed to a caller that deletes.
   */
  it.live("rejects a cached path that escapes the source's roots", () =>
    Effect.gen(function* () {
      const locator = yield* SessionLocatorService;

      const result = yield* Effect.either(locator.locate(PROJECT_ID, "escaped"));

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("UnsafeSessionPathError");
        expect(result.left).toMatchObject({ reason: "outside-source-roots" });
      }
    }).pipe(
      Effect.provide(SessionLocatorService.Live),
      Effect.provide(
        layerFor(seedSession({ id: "escaped", filePath: "/etc/shadow", source: "claude-code" })),
      ),
    ),
  );

  /**
   * Roots are read from the adapter the row names, so a source with no enabled
   * adapter has none — there is nothing to check the path against and nothing
   * that could read the file. Validating against the union of every source's
   * roots instead would let such a row pass on another CLI's directory.
   */
  it.live("refuses a session whose source has no enabled adapter", () =>
    Effect.gen(function* () {
      const locator = yield* SessionLocatorService;

      const result = yield* Effect.either(locator.locate(PROJECT_ID, "foreign"));

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left).toMatchObject({ reason: "source-not-readable" });
      }
    }).pipe(
      Effect.provide(SessionLocatorService.Live),
      Effect.provide(
        layerFor(
          seedSession({
            id: "foreign",
            // Inside a root Lantern does read, so only the source rules it out.
            filePath: `${FIXTURE_PROJECT}/foreign.jsonl`,
            source: "some-future-cli",
          }),
        ),
      ),
    ),
  );

  it.live("refuses a session id that is not one", () =>
    Effect.gen(function* () {
      const locator = yield* SessionLocatorService;

      const result = yield* Effect.either(locator.locate(PROJECT_ID, "../../etc/shadow"));

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("SessionNotFoundError");
      }
    }).pipe(
      Effect.provide(SessionLocatorService.Live),
      Effect.provide(
        layerFor(
          seedSession({
            id: "known-session",
            filePath: `${FIXTURE_PROJECT}/known-session.jsonl`,
            source: "claude-code",
          }),
        ),
      ),
    ),
  );

  it.live("refuses a session that belongs to a different project", () =>
    Effect.gen(function* () {
      const locator = yield* SessionLocatorService;

      const result = yield* Effect.either(
        locator.locate(encodeProjectId("/other"), "known-session"),
      );

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("SessionNotFoundError");
      }
    }).pipe(
      Effect.provide(SessionLocatorService.Live),
      Effect.provide(
        layerFor(
          seedSession({
            id: "known-session",
            filePath: `${FIXTURE_PROJECT}/known-session.jsonl`,
            source: "claude-code",
          }),
        ),
      ),
    ),
  );
});

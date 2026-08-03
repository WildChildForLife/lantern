import { FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe, expect } from "vitest";
import { LanternOptionsService } from "../../platform/services/LanternOptionsService.ts";
import { getSourceConfigPath, SourceConfigBaseDir } from "../config.ts";
import { SourceConfigService } from "./SourceConfigService.ts";

const withTempBaseDir = <A, E>(
  use: (baseDir: string) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const baseDir = yield* fs.makeTempDirectoryScoped();
    return yield* use(baseDir);
  }).pipe(Effect.scoped, Effect.provide(NodeContext.layer));

const serviceLayer = (baseDir: string) =>
  SourceConfigService.Live.pipe(
    Layer.provide(Layer.succeed(SourceConfigBaseDir, baseDir)),
    // Merged, not just provided: the tests drive loadCliOptions through the
    // same service instance the config service reads.
    Layer.provideMerge(LanternOptionsService.Live),
    Layer.provide(NodeContext.layer),
  );

/**
 * The server loads CLI options after the layers are built, so a test that wants
 * them visible has to do the same — reading them at construction time is the
 * bug these cover.
 */
const withCliSources = (sources: string[]) =>
  Effect.gen(function* () {
    const optionsService = yield* LanternOptionsService;
    yield* optionsService.loadCliOptions({ port: "3000", hostname: "localhost", source: sources });
  });

describe("SourceConfigService", () => {
  it.live("reads Claude Code only when nothing has been chosen", () =>
    withTempBaseDir((baseDir) =>
      Effect.gen(function* () {
        const service = yield* SourceConfigService;

        expect((yield* service.get()).enabled).toStrictEqual(["claude-code"]);
      }).pipe(Effect.provide(serviceLayer(baseDir))),
    ),
  );

  it.live("persists a selection so it survives a restart", () =>
    withTempBaseDir((baseDir) =>
      Effect.gen(function* () {
        const service = yield* SourceConfigService;
        yield* service.setEnabled(["claude-code"]);

        const fs = yield* FileSystem.FileSystem;
        const configPath = yield* getSourceConfigPath.pipe(
          Effect.provide(Layer.succeed(SourceConfigBaseDir, baseDir)),
        );

        expect(yield* fs.exists(configPath)).toBe(true);
        expect(yield* fs.readFileString(configPath)).toContain("claude-code");
      }).pipe(Effect.provide(serviceLayer(baseDir))),
    ),
  );

  it.live("reports what changed so only those sources are re-read", () =>
    withTempBaseDir((baseDir) =>
      Effect.gen(function* () {
        const service = yield* SourceConfigService;

        const unchanged = yield* service.setEnabled(["claude-code"]);

        expect(unchanged.added).toStrictEqual([]);
        expect(unchanged.removed).toStrictEqual([]);
      }).pipe(Effect.provide(serviceLayer(baseDir))),
    ),
  );

  /**
   * Turning everything off would leave a dashboard with nothing in it and no
   * control left to turn anything back on.
   */
  it.live("refuses to end up with no sources at all", () =>
    withTempBaseDir((baseDir) =>
      Effect.gen(function* () {
        const service = yield* SourceConfigService;
        yield* service.setEnabled([]);

        expect((yield* service.get()).enabled).toStrictEqual(["claude-code"]);
      }).pipe(Effect.provide(serviceLayer(baseDir))),
    ),
  );

  it.live("falls back to the default when the stored file is not readable", () =>
    withTempBaseDir((baseDir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.makeDirectory(path.join(baseDir, "sources"), { recursive: true });
        yield* fs.writeFileString(path.join(baseDir, "sources", "sources.json"), "{ not json");

        const service = yield* Effect.provide(SourceConfigService, serviceLayer(baseDir));

        expect((yield* service.get()).enabled).toStrictEqual(["claude-code"]);
      }),
    ),
  );

  it.live("applies --source even though options load after the layers are built", () =>
    withTempBaseDir((baseDir) =>
      Effect.gen(function* () {
        yield* withCliSources(["claude-code"]);

        const service = yield* SourceConfigService;

        expect((yield* service.get()).enabled).toStrictEqual(["claude-code"]);
      }).pipe(Effect.provide(serviceLayer(baseDir))),
    ),
  );

  /** A one-off scope must not become the stored selection. */
  it.live("refuses to change the selection during a --source run", () =>
    withTempBaseDir((baseDir) =>
      Effect.gen(function* () {
        yield* withCliSources(["claude-code"]);

        const service = yield* SourceConfigService;
        const result = yield* Effect.either(service.setEnabled([]));

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left._tag).toBe("SourceSelectionLockedError");
        }
      }).pipe(Effect.provide(serviceLayer(baseDir))),
    ),
  );

  /**
   * The caller purges and re-reads from the returned diff, so a selection that
   * could not be written must not be reported as applied.
   */
  it.live("fails when the selection cannot be written", () =>
    withTempBaseDir((baseDir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        // A file where the config directory belongs: the write cannot succeed.
        yield* fs.writeFileString(path.join(baseDir, "sources"), "not a directory");

        const service = yield* Effect.provide(SourceConfigService, serviceLayer(baseDir));
        const result = yield* Effect.either(service.setEnabled(["claude-code"]));

        expect(result._tag).toBe("Left");
      }),
    ),
  );
});

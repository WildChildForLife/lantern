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
    Layer.provide(LanternOptionsService.Live),
    Layer.provide(NodeContext.layer),
  );

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
});

import { FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe, expect } from "vitest";
import { CliConfigBaseDir } from "../config/cliConfigStore.ts";
import { parseUpdateCache, readUpdateCache, writeUpdateCache } from "./updateCache.ts";

const withTempBaseDir = <A, E>(
  use: (baseDir: string) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const baseDir = yield* fs.makeTempDirectoryScoped();
    return yield* use(baseDir);
  }).pipe(Effect.scoped, Effect.provide(NodeContext.layer));

const withBaseDir = (baseDir: string) => Layer.succeed(CliConfigBaseDir, baseDir);

describe("parseUpdateCache", () => {
  it("reads what the last check wrote", () => {
    expect(parseUpdateCache({ checkedAt: 1, latest: "0.4.0" })).toEqual({
      checkedAt: 1,
      latest: "0.4.0",
    });
  });

  it("treats anything else as never having checked", () => {
    expect(parseUpdateCache({ checkedAt: "yesterday", latest: "0.4.0" })).toBeNull();
    expect(parseUpdateCache(null)).toBeNull();
  });
});

describe("updateCache", () => {
  it.live("reports nothing before the first check", () =>
    withTempBaseDir((baseDir) =>
      Effect.gen(function* () {
        expect(yield* readUpdateCache).toBeNull();
      }).pipe(Effect.provide(withBaseDir(baseDir))),
    ),
  );

  it.live("remembers what the registry said", () =>
    withTempBaseDir((baseDir) =>
      Effect.gen(function* () {
        yield* writeUpdateCache({ checkedAt: 1_760_000_000_000, latest: "0.4.0" });

        expect(yield* readUpdateCache).toEqual({ checkedAt: 1_760_000_000_000, latest: "0.4.0" });
      }).pipe(Effect.provide(withBaseDir(baseDir))),
    ),
  );

  /** A file somebody edited costs a check, not a launch. */
  it.live("shrugs off a cache it cannot read", () =>
    withTempBaseDir((baseDir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        yield* fs.writeFileString(path.join(baseDir, "update-check.json"), "{ not json");

        expect(yield* readUpdateCache).toBeNull();
      }).pipe(Effect.provide(withBaseDir(baseDir))),
    ),
  );
});

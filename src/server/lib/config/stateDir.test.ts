import { FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";
import {
  LEGACY_STATE_DIR_NAME,
  migrateLegacyStateDir,
  STATE_DIR_NAME,
  stateDirPath,
} from "./stateDir.ts";

const withTempHome = <A>(
  use: (home: string) => Effect.Effect<A, unknown, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const home = yield* fs.makeTempDirectoryScoped();
    return yield* use(home);
  }).pipe(Effect.scoped, Effect.provide(NodeContext.layer));

describe("stateDirPath", () => {
  it.live("resolves the state directory inside a home directory", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;

      expect(stateDirPath(path, "/home/someone")).toBe(`/home/someone/${STATE_DIR_NAME}`);
    }).pipe(Effect.provide(NodeContext.layer)),
  );
});

describe("migrateLegacyStateDir", () => {
  it.live("moves a directory left by a pre-rename build", () =>
    withTempHome((home) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const legacyDir = path.join(home, LEGACY_STATE_DIR_NAME);
        yield* fs.makeDirectory(legacyDir, { recursive: true });
        yield* fs.writeFileString(path.join(legacyDir, "cache.db"), "cached");

        yield* migrateLegacyStateDir(home);

        const migrated = yield* fs.readFileString(path.join(home, STATE_DIR_NAME, "cache.db"));
        expect(migrated).toBe("cached");
        expect(yield* fs.exists(legacyDir)).toBe(false);
      }),
    ),
  );

  it.live("keeps the current directory when both exist", () =>
    withTempHome((home) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const legacyDir = path.join(home, LEGACY_STATE_DIR_NAME);
        const stateDir = path.join(home, STATE_DIR_NAME);
        yield* fs.makeDirectory(legacyDir, { recursive: true });
        yield* fs.makeDirectory(stateDir, { recursive: true });
        yield* fs.writeFileString(path.join(legacyDir, "cache.db"), "old");
        yield* fs.writeFileString(path.join(stateDir, "cache.db"), "current");

        yield* migrateLegacyStateDir(home);

        expect(yield* fs.readFileString(path.join(stateDir, "cache.db"))).toBe("current");
        expect(yield* fs.exists(legacyDir)).toBe(true);
      }),
    ),
  );

  it.live("does nothing when there is nothing to migrate", () =>
    withTempHome((home) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        yield* migrateLegacyStateDir(home);

        expect(yield* fs.exists(path.join(home, STATE_DIR_NAME))).toBe(false);
      }),
    ),
  );
});

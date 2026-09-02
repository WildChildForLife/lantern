import { FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe, expect } from "vitest";
import { defaultCliConfig } from "./cliConfig.ts";
import {
  CliConfigBaseDir,
  cliConfigExists,
  readCliConfig,
  readCliConfigResult,
  writeCliConfig,
} from "./cliConfigStore.ts";

const withTempBaseDir = <A, E>(
  use: (baseDir: string) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const baseDir = yield* fs.makeTempDirectoryScoped();
    return yield* use(baseDir);
  }).pipe(Effect.scoped, Effect.provide(NodeContext.layer));

const withBaseDir = (baseDir: string) => Layer.succeed(CliConfigBaseDir, baseDir);

describe("cliConfigStore", () => {
  it.live("reads the defaults when nothing has been written", () =>
    withTempBaseDir((baseDir) =>
      Effect.gen(function* () {
        expect(yield* readCliConfig).toStrictEqual(defaultCliConfig);
      }).pipe(Effect.provide(withBaseDir(baseDir))),
    ),
  );

  it.live("reports that no settings exist yet, so the wizard can offer itself", () =>
    withTempBaseDir((baseDir) =>
      Effect.gen(function* () {
        expect(yield* cliConfigExists).toBe(false);

        yield* writeCliConfig({ ...defaultCliConfig, port: 3400 });

        expect(yield* cliConfigExists).toBe(true);
      }).pipe(Effect.provide(withBaseDir(baseDir))),
    ),
  );

  it.live("persists settings so they survive a restart", () =>
    withTempBaseDir((baseDir) =>
      Effect.gen(function* () {
        yield* writeCliConfig({
          ...defaultCliConfig,
          port: 3400,
          hostname: "0.0.0.0",
          browse: { resumeAction: "copy-id" },
        });

        const stored = yield* readCliConfig;

        expect(stored.port).toBe(3400);
        expect(stored.hostname).toBe("0.0.0.0");
        expect(stored.browse).toStrictEqual({ resumeAction: "copy-id" });
      }).pipe(Effect.provide(withBaseDir(baseDir))),
    ),
  );

  it.live("creates the state directory on the first write", () =>
    withTempBaseDir((baseDir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const nested = path.join(baseDir, "does", "not", "exist");

        yield* writeCliConfig(defaultCliConfig).pipe(
          Effect.provide(Layer.succeed(CliConfigBaseDir, nested)),
        );

        expect(yield* fs.exists(path.join(nested, "config.json"))).toBe(true);
      }),
    ),
  );

  /** A hand-edited file must never be the reason Lantern will not start. */
  it.live("falls back to the defaults when the stored file is not readable", () =>
    withTempBaseDir((baseDir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.writeFileString(path.join(baseDir, "config.json"), "{ not json");

        expect(yield* readCliConfig.pipe(Effect.provide(withBaseDir(baseDir)))).toStrictEqual(
          defaultCliConfig,
        );
      }),
    ),
  );

  it.live("falls back to the defaults when a stored value is out of range", () =>
    withTempBaseDir((baseDir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.writeFileString(path.join(baseDir, "config.json"), `{"port":70000}`);

        expect(yield* readCliConfig.pipe(Effect.provide(withBaseDir(baseDir)))).toStrictEqual(
          defaultCliConfig,
        );
      }),
    ),
  );

  /** What tells `loadStoredOptions` there is something worth mentioning. */
  it.live("reports an unreadable file, and where it is", () =>
    withTempBaseDir((baseDir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const configPath = path.join(baseDir, "config.json");
        yield* fs.writeFileString(configPath, "{ not json");

        const result = yield* readCliConfigResult.pipe(Effect.provide(withBaseDir(baseDir)));

        expect(result.unreadable).toBe(true);
        expect(result.configPath).toBe(configPath);
        expect(result.config).toStrictEqual(defaultCliConfig);
      }),
    ),
  );

  /** A first launch has no file, which is not a problem to report. */
  it.live("does not call a missing file unreadable", () =>
    withTempBaseDir((baseDir) =>
      Effect.gen(function* () {
        const result = yield* readCliConfigResult.pipe(Effect.provide(withBaseDir(baseDir)));

        expect(result.unreadable).toBe(false);
      }),
    ),
  );

  /**
   * The case that used to pass for a first launch on every single launch: the
   * file is there, `exists` says so, and opening it fails. Their settings are
   * gone and nothing said a word.
   */
  it.live("reports a file that is there and will not open", () =>
    withTempBaseDir((baseDir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        // A directory where the file belongs: it exists, and it cannot be read.
        yield* fs.makeDirectory(path.join(baseDir, "config.json"));

        const result = yield* readCliConfigResult.pipe(Effect.provide(withBaseDir(baseDir)));

        expect(result.unreadable).toBe(true);
        expect(result.config).toStrictEqual(defaultCliConfig);
      }),
    ),
  );

  /** An interrupted write, or a bare `touch`. Nothing was lost. */
  it.live("does not call an empty file unreadable", () =>
    withTempBaseDir((baseDir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.writeFileString(path.join(baseDir, "config.json"), "\n  \n");

        const result = yield* readCliConfigResult.pipe(Effect.provide(withBaseDir(baseDir)));

        expect(result.unreadable).toBe(false);
        expect(result.config).toStrictEqual(defaultCliConfig);
      }),
    ),
  );

  /** Valid JSON that the schema turns away is just as lost as broken JSON. */
  it.live("reports a file whose settings do not fit the schema", () =>
    withTempBaseDir((baseDir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.writeFileString(path.join(baseDir, "config.json"), `{"port":70000}`);

        const result = yield* readCliConfigResult.pipe(Effect.provide(withBaseDir(baseDir)));

        expect(result.unreadable).toBe(true);
      }),
    ),
  );

  it.live("does not call a file it understood unreadable", () =>
    withTempBaseDir((baseDir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.writeFileString(path.join(baseDir, "config.json"), `{"port":3400}`);

        const result = yield* readCliConfigResult.pipe(Effect.provide(withBaseDir(baseDir)));

        expect(result.unreadable).toBe(false);
        expect(result.config.port).toBe(3400);
      }),
    ),
  );

  it.live("fails when the settings cannot be written", () =>
    withTempBaseDir((baseDir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        // A file where the config file belongs: the write cannot succeed.
        yield* fs.writeFileString(path.join(baseDir, "config.json"), "");
        yield* fs.remove(path.join(baseDir, "config.json"));
        yield* fs.makeDirectory(path.join(baseDir, "config.json"));

        const result = yield* Effect.either(
          writeCliConfig(defaultCliConfig).pipe(Effect.provide(withBaseDir(baseDir))),
        );

        expect(result._tag).toBe("Left");
      }),
    ),
  );
});

import { FileSystem, Path } from "@effect/platform";
import { Context, Effect, Layer } from "effect";
import { stateDirPath } from "../../lib/config/stateDir.ts";
import { resolveHomeDirectory } from "../platform/resolveHomeDirectory.ts";
import { EnvService } from "../platform/services/EnvService.ts";
import { defaultSourceConfig, type SourceConfig, sourceConfigSchema } from "./schema.ts";

const CONFIG_DIR = "sources";
const CONFIG_FILE = "sources.json";

/** Base directory of the config file, overridable in tests. */
export class SourceConfigBaseDir extends Context.Tag("SourceConfigBaseDir")<
  SourceConfigBaseDir,
  string
>() {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const envService = yield* EnvService;
      const path = yield* Path.Path;
      const homeDirectory = resolveHomeDirectory(
        yield* envService.getEnv("HOME"),
        yield* envService.getEnv("USERPROFILE"),
      );
      return stateDirPath(path, homeDirectory ?? "/");
    }),
  );
}

export const getSourceConfigPath = Effect.gen(function* () {
  const path = yield* Path.Path;
  const baseDir = yield* SourceConfigBaseDir;
  return path.join(baseDir, CONFIG_DIR, CONFIG_FILE);
});

/**
 * Reads the stored selection, falling back to the default rather than failing.
 *
 * A malformed file must not stop the server: the cost of ignoring it is that
 * Lantern reads Claude Code only, which is where it started.
 */
export const readSourceConfig = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const configPath = yield* getSourceConfigPath;

  const exists = yield* fs.exists(configPath).pipe(Effect.catchAll(() => Effect.succeed(false)));
  if (!exists) {
    return defaultSourceConfig;
  }

  const content = yield* fs
    .readFileString(configPath)
    .pipe(Effect.catchAll(() => Effect.succeed("")));
  if (content === "") {
    return defaultSourceConfig;
  }

  const parsed = yield* Effect.try({
    try: (): unknown => JSON.parse(content),
    catch: () => null,
  }).pipe(Effect.catchAll(() => Effect.succeed(null)));

  const result = sourceConfigSchema.safeParse(parsed);
  if (!result.success) {
    yield* Effect.logWarning(`Ignoring unreadable source config at ${configPath}`);
    return defaultSourceConfig;
  }

  return result.data;
});

export const writeSourceConfig = (config: SourceConfig) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const configPath = yield* getSourceConfigPath;

    yield* fs.makeDirectory(path.dirname(configPath), { recursive: true });
    yield* fs.writeFileString(configPath, `${JSON.stringify(config, null, 2)}\n`);
  });

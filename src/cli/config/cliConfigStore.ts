import { FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Context, Effect, Layer } from "effect";
import { resolveHomeDirectory } from "../../server/core/platform/resolveHomeDirectory.ts";
import { EnvService } from "../../server/core/platform/services/EnvService.ts";
import { stateDirPath } from "../../server/lib/config/stateDir.ts";
import {
  type CliConfig,
  defaultCliConfig,
  parseCliConfig,
  type ResumeAction,
} from "./cliConfig.ts";

const CONFIG_FILE = "config.json";

/** Base directory of the settings file, overridable in tests. */
export class CliConfigBaseDir extends Context.Tag("CliConfigBaseDir")<CliConfigBaseDir, string>() {
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

export const getCliConfigPath = Effect.gen(function* () {
  const path = yield* Path.Path;
  const baseDir = yield* CliConfigBaseDir;
  return path.join(baseDir, CONFIG_FILE);
});

/** Whether the wizard has ever run. Drives the first-launch offer. */
export const cliConfigExists = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const configPath = yield* getCliConfigPath;

  return yield* fs.exists(configPath).pipe(Effect.catchAll(() => Effect.succeed(false)));
});

/** What a read found, for the one caller that has somebody to tell about it. */
export type CliConfigResult = {
  config: CliConfig;
  /** Where the settings live, whether or not this read got anything from it. */
  configPath: string;
  /**
   * Whether a file was there and could not be understood.
   *
   * A missing file is not unreadable — that is a first launch, and the defaults
   * are the right answer rather than a thing worth mentioning.
   */
  unreadable: boolean;
};

/**
 * Reads stored settings, falling back to the defaults rather than failing.
 *
 * This runs before anything else on every launch, so a file somebody edited by
 * hand must cost them their preferences and nothing more.
 *
 * Nothing is printed from here. The file is opened two or three times on a
 * single launch and each read would be entitled to complain about the same
 * file, so the reporting belongs to the caller that has a reader in front of it
 * — see `loadStoredOptions`.
 */
export const readCliConfigResult = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const configPath = yield* getCliConfigPath;
  const fallback: CliConfigResult = { config: defaultCliConfig, configPath, unreadable: false };

  if (!(yield* cliConfigExists)) {
    return fallback;
  }

  const content = yield* fs
    .readFileString(configPath)
    .pipe(Effect.catchAll(() => Effect.succeed("")));
  if (content === "") {
    return fallback;
  }

  const raw = yield* Effect.try({
    try: (): unknown => JSON.parse(content),
    catch: () => null,
  }).pipe(Effect.catchAll(() => Effect.succeed(null)));

  const parsed = parseCliConfig(raw);
  if (parsed === null) {
    return { ...fallback, unreadable: true };
  }

  return { config: parsed, configPath, unreadable: false };
});

/** The settings alone, for the callers that have nothing to say about them. */
export const readCliConfig = readCliConfigResult.pipe(Effect.map((result) => result.config));

/**
 * Remembers a new choice of what Enter does, leaving every other setting alone.
 *
 * Read-modify-write rather than a blind overwrite: the board is changing one
 * preference, not restating the whole file.
 */
export const saveResumeAction = (action: ResumeAction): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const current = yield* readCliConfig;

      yield* writeCliConfig({ ...current, browse: { ...current.browse, resumeAction: action } });
    }).pipe(
      Effect.provide(CliConfigBaseDir.Live),
      Effect.provide(EnvService.Live),
      Effect.provide(NodeContext.layer),
    ),
  );

export const writeCliConfig = (config: CliConfig) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const configPath = yield* getCliConfigPath;

    yield* fs.makeDirectory(path.dirname(configPath), { recursive: true });
    yield* fs.writeFileString(configPath, `${JSON.stringify(config, null, 2)}\n`);
  });

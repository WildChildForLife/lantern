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

/** What a read found, for the callers that have somebody to tell about it. */
export type CliConfigResult = {
  readonly config: CliConfig;
  /** Where the settings live, whether or not this read got anything from it. */
  readonly configPath: string;
  /**
   * Whether a file was there and this read got nothing usable out of it.
   *
   * True for a file that cannot be opened as much as for one that cannot be
   * parsed: from the reader's side those are the same loss, and permissions are
   * the likelier of the two to happen by accident.
   *
   * A missing file is not unreadable — that is a first launch, and the defaults
   * are the right answer rather than a thing worth mentioning. Neither is an
   * empty one, which is what an interrupted write leaves behind and what a
   * fresh `touch` makes.
   */
  readonly unreadable: boolean;
};

/**
 * Reads stored settings, falling back to the defaults rather than failing.
 *
 * This runs before anything else on every launch, so a file somebody edited by
 * hand must cost them their preferences and nothing more.
 *
 * Nothing is printed from here. `loadStoredOptions` can run more than once in a
 * launch — the wizard reads the file, and a cancelled wizard is followed by
 * another read — so the reporting belongs to the caller that has a reader in
 * front of it and can say a thing once.
 */
export const readCliConfigResult = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const configPath = yield* getCliConfigPath;
  const fallback: CliConfigResult = { config: defaultCliConfig, configPath, unreadable: false };

  if (!(yield* cliConfigExists)) {
    return fallback;
  }

  // `null` rather than `""` for a failed read, because the two are different
  // answers: an empty file is a file with no settings in it, and a file that
  // will not open is settings that have been lost. Folding them together is
  // what let a permission problem pass for a first launch, silently, on every
  // launch after it.
  const content = yield* fs
    .readFileString(configPath)
    .pipe(Effect.catchAll(() => Effect.succeed(null)));

  if (content === null) {
    return { ...fallback, unreadable: true };
  }

  if (content.trim() === "") {
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
 *
 * Which is exactly why a file that could not be read stops it. The read falls
 * back to the defaults, so writing it back would not be a merge — it would
 * replace every setting the file had with a default, on a keystroke that meant
 * to change one preference, moments after the launch told the reader their file
 * was worth fixing. One preference is not worth the rest of them, so this does
 * nothing and the file stays as it was, still fixable.
 */
export const saveResumeAction = (action: ResumeAction): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const current = yield* readCliConfigResult;

      if (current.unreadable) {
        return;
      }

      yield* writeCliConfig({
        ...current.config,
        browse: { ...current.config.browse, resumeAction: action },
      });
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

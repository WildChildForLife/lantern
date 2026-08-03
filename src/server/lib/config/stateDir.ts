import { FileSystem, Path } from "@effect/platform";
import { Effect } from "effect";

/**
 * Everything Lantern writes — the cache database, push keys, schedules — lives
 * in this directory, next to Claude Code's own `.claude`.
 */
export const STATE_DIR_NAME = ".lantern";

/** Where the same data lived before the project was renamed. */
export const LEGACY_STATE_DIR_NAME = ".claude-code-viewer";

/** Absolute path of the state directory for a given home directory. */
export const stateDirPath = (path: Path.Path, homeDirectory: string): string =>
  path.resolve(homeDirectory, STATE_DIR_NAME);

/**
 * Moves a state directory left by a pre-rename build to its new name, once, at
 * startup. Failure is deliberately silent: the worst case is a cold cache and a
 * new push key pair, which is not worth refusing to boot over.
 */
export const migrateLegacyStateDir = (homeDirectory: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const stateDir = stateDirPath(path, homeDirectory);
    if (yield* fs.exists(stateDir)) {
      return;
    }

    const legacyDir = path.resolve(homeDirectory, LEGACY_STATE_DIR_NAME);
    if (!(yield* fs.exists(legacyDir))) {
      return;
    }

    yield* Effect.logInfo(`Moving ${legacyDir} to ${stateDir}`);
    yield* fs.rename(legacyDir, stateDir);
  }).pipe(Effect.ignoreLogged);

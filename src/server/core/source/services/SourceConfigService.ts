import { FileSystem, Path } from "@effect/platform";
import { Context, Data, Effect, Layer, Ref, SubscriptionRef } from "effect";
import { LanternOptionsService } from "../../platform/services/LanternOptionsService.ts";
import { readSourceConfig, SourceConfigBaseDir, writeSourceConfig } from "../config.ts";
import { CLAUDE_CODE_SOURCE_ID, type SourceId } from "../models/SourceId.ts";
import { defaultSourceConfig, type SourceConfig } from "../schema.ts";

/** The selection is fixed for this run because it was named on the command line. */
export class SourceSelectionLockedError extends Data.TaggedError("SourceSelectionLockedError")<{
  readonly enabled: readonly SourceId[];
}> {}

export class SourceConfigWriteError extends Data.TaggedError("SourceConfigWriteError")<{
  readonly cause: unknown;
}> {}

export type SourceSelectionChange = {
  readonly added: readonly SourceId[];
  readonly removed: readonly SourceId[];
};

/** Holds which sources Lantern reads, and persists changes to that choice. */
export type ISourceConfigService = {
  readonly get: () => Effect.Effect<SourceConfig>;
  readonly setEnabled: (
    enabled: readonly SourceId[],
  ) => Effect.Effect<SourceSelectionChange, SourceSelectionLockedError | SourceConfigWriteError>;
};

const LayerImpl = Effect.gen(function* () {
  const optionsService = yield* LanternOptionsService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const baseDir = yield* SourceConfigBaseDir;

  const configEnv = Layer.mergeAll(
    Layer.succeed(FileSystem.FileSystem, fs),
    Layer.succeed(Path.Path, path),
    Layer.succeed(SourceConfigBaseDir, baseDir),
  );

  const ref = yield* SubscriptionRef.make<SourceConfig>(defaultSourceConfig);
  const loadedRef = yield* Ref.make(false);
  // One loader at a time, so two concurrent first reads cannot both parse the
  // file and race each other into the ref.
  const lock = yield* Effect.makeSemaphore(1);

  /**
   * Reads the stored file and the command line on first use, not while the
   * layer is being built.
   *
   * CLI options are loaded once the program is already running, so anything
   * reading them during layer construction sees only the environment — which is
   * how `--source` came to be accepted and then silently ignored.
   */
  const load = lock.withPermits(1)(
    Effect.gen(function* () {
      if (yield* Ref.get(loadedRef)) {
        return;
      }

      const stored = yield* readSourceConfig.pipe(
        Effect.provide(configEnv),
        Effect.catchAll(() => Effect.succeed(defaultSourceConfig)),
      );

      const cliSources = yield* optionsService.getOption("sources");
      const enabled =
        cliSources === undefined || cliSources.length === 0 ? stored.enabled : cliSources;

      yield* SubscriptionRef.set(ref, { ...stored, enabled });
      yield* Ref.set(loadedRef, true);
    }),
  );

  const get = () => load.pipe(Effect.flatMap(() => SubscriptionRef.get(ref)));

  const setEnabled = (next: readonly SourceId[]) =>
    Effect.gen(function* () {
      yield* load;

      // A run scoped on the command line stays scoped: persisting a toggle made
      // during it would quietly turn a one-off into the stored selection.
      const cliSources = yield* optionsService.getOption("sources");
      if (cliSources !== undefined && cliSources.length > 0) {
        return yield* new SourceSelectionLockedError({ enabled: cliSources });
      }

      // Claude Code is what Lantern is for; an empty selection would leave a
      // dashboard with nothing in it and no control left to undo it.
      const resolved = next.length === 0 ? [CLAUDE_CODE_SOURCE_ID] : [...new Set(next)];

      // Read and write in one step: two concurrent calls would otherwise diff
      // against the same state, and the later one would silently win.
      const change = yield* SubscriptionRef.modify(ref, (current) => [
        {
          added: resolved.filter((id) => !current.enabled.includes(id)),
          removed: current.enabled.filter((id) => !resolved.includes(id)),
        },
        { ...current, enabled: resolved },
      ]);

      // The caller purges and re-reads from this result, so a selection that
      // could not be stored has to fail rather than be acted on and then lost.
      yield* writeSourceConfig({ ...(yield* SubscriptionRef.get(ref)) }).pipe(
        Effect.provide(configEnv),
        Effect.mapError((cause) => new SourceConfigWriteError({ cause })),
      );

      return change;
    });

  return { get, setEnabled } satisfies ISourceConfigService;
});

export class SourceConfigService extends Context.Tag("SourceConfigService")<
  SourceConfigService,
  ISourceConfigService
>() {
  static readonly Live = Layer.effect(this, LayerImpl);
}

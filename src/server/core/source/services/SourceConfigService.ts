import { FileSystem, Path } from "@effect/platform";
import { Context, Effect, Layer, SubscriptionRef } from "effect";
import { LanternOptionsService } from "../../platform/services/LanternOptionsService.ts";
import { readSourceConfig, SourceConfigBaseDir, writeSourceConfig } from "../config.ts";
import { CLAUDE_CODE_SOURCE_ID, type SourceId } from "../models/SourceId.ts";
import { defaultSourceConfig, type SourceConfig } from "../schema.ts";

/**
 * Holds which sources Lantern reads, and persists changes.
 *
 * A `SubscriptionRef` so the watcher and the sync engine can react to a change
 * without polling, and so a change takes effect without a restart.
 */
export type ISourceConfigService = {
  readonly get: () => Effect.Effect<SourceConfig>;
  readonly changes: SubscriptionRef.SubscriptionRef<SourceConfig>;
  readonly setEnabled: (enabled: readonly SourceId[]) => Effect.Effect<{
    readonly added: readonly SourceId[];
    readonly removed: readonly SourceId[];
  }>;
};

const LayerImpl = Effect.gen(function* () {
  const optionsService = yield* LanternOptionsService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const baseDir = yield* SourceConfigBaseDir;

  // The file services are captured here so the returned functions carry no
  // requirements of their own.
  const configEnv = Layer.mergeAll(
    Layer.succeed(FileSystem.FileSystem, fs),
    Layer.succeed(Path.Path, path),
    Layer.succeed(SourceConfigBaseDir, baseDir),
  );

  const stored = yield* readSourceConfig.pipe(
    Effect.provide(configEnv),
    Effect.catchAll(() => Effect.succeed(defaultSourceConfig)),
  );

  // A source named on the command line wins over the stored selection: it is
  // the more deliberate instruction, and it is how a one-off run is scoped.
  const cliSources = yield* optionsService.getOption("sources");
  const enabled = cliSources === undefined || cliSources.length === 0 ? stored.enabled : cliSources;

  const ref = yield* SubscriptionRef.make<SourceConfig>({ ...stored, enabled });

  const setEnabled = (next: readonly SourceId[]) =>
    Effect.gen(function* () {
      const current = yield* SubscriptionRef.get(ref);

      // Claude Code is what Lantern is for; disabling every source would leave
      // a dashboard with nothing to show and no way back from the UI.
      const resolved = next.length === 0 ? [CLAUDE_CODE_SOURCE_ID] : [...new Set(next)];

      const added = resolved.filter((id) => !current.enabled.includes(id));
      const removed = current.enabled.filter((id) => !resolved.includes(id));

      const updated: SourceConfig = { ...current, enabled: resolved };
      yield* SubscriptionRef.set(ref, updated);
      yield* writeSourceConfig(updated).pipe(
        Effect.provide(configEnv),
        Effect.catchAll((error) =>
          Effect.logWarning(`Could not persist the source selection: ${String(error)}`),
        ),
      );

      return { added, removed };
    });

  return {
    get: () => SubscriptionRef.get(ref),
    changes: ref,
    setEnabled,
  } satisfies ISourceConfigService;
});

export class SourceConfigService extends Context.Tag("SourceConfigService")<
  SourceConfigService,
  ISourceConfigService
>() {
  static readonly Live = Layer.effect(this, LayerImpl);
}

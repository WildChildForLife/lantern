import { Context, Effect, Layer } from "effect";
import { claudeCodeSourceAdapter } from "../adapters/claude-code/ClaudeCodeSourceAdapter.ts";
import type { SourceAdapter } from "../models/SourceAdapter.ts";
import type { SourceId } from "../models/SourceId.ts";
import { SourceConfigService } from "./SourceConfigService.ts";

/**
 * Every adapter Lantern knows about, and which of them are currently read.
 *
 * Adapters are values in one registry rather than a service each, so ingestion,
 * watching and the settings screen can iterate over them. Registration is
 * static; enablement is the user's, and can change while the server runs.
 */
export type ISourceRegistry = {
  readonly all: readonly SourceAdapter[];
  readonly get: (sourceId: SourceId) => SourceAdapter | undefined;
  readonly enabled: () => Effect.Effect<readonly SourceAdapter[]>;
};

export const ALL_SOURCE_ADAPTERS: readonly SourceAdapter[] = [claudeCodeSourceAdapter];

const makeRegistry = (
  adapters: readonly SourceAdapter[],
  enabledIds: () => Effect.Effect<readonly SourceId[]>,
): ISourceRegistry => ({
  all: adapters,
  get: (sourceId) => adapters.find((adapter) => adapter.id === sourceId),
  enabled: () =>
    enabledIds().pipe(Effect.map((ids) => adapters.filter((adapter) => ids.includes(adapter.id)))),
});

export class SourceRegistry extends Context.Tag("SourceRegistry")<
  SourceRegistry,
  ISourceRegistry
>() {
  static readonly Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const configService = yield* SourceConfigService;
      return makeRegistry(ALL_SOURCE_ADAPTERS, () =>
        configService.get().pipe(Effect.map((config) => config.enabled)),
      );
    }),
  );

  /** Registry over an explicit adapter set, all enabled. For tests. */
  static readonly withAdapters = (
    adapters: readonly SourceAdapter[],
  ): Layer.Layer<SourceRegistry> =>
    Layer.succeed(
      SourceRegistry,
      makeRegistry(adapters, () => Effect.succeed(adapters.map((adapter) => adapter.id))),
    );
}

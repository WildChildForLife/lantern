import { Context, Effect, Layer } from "effect";
import { claudeCodeSourceAdapter } from "../adapters/claude-code/ClaudeCodeSourceAdapter.ts";
import type { SourceAdapter } from "../models/SourceAdapter.ts";
import type { SourceId } from "../models/SourceId.ts";

/**
 * Every adapter Lantern knows about.
 *
 * Adapters are values in one registry rather than a service each, so ingestion,
 * watching and the settings screen can iterate over them. Which of them are
 * actually read is a separate, persisted decision.
 */
export type ISourceRegistry = {
  readonly all: readonly SourceAdapter[];
  readonly get: (sourceId: SourceId) => SourceAdapter | undefined;
  /** Adapters currently enabled for ingestion. */
  readonly enabled: () => Effect.Effect<readonly SourceAdapter[]>;
};

const makeRegistry = (adapters: readonly SourceAdapter[]): ISourceRegistry => ({
  all: adapters,
  get: (sourceId) => adapters.find((adapter) => adapter.id === sourceId),
  // Every registered source is read until the selection UI lands.
  enabled: () => Effect.succeed(adapters),
});

export class SourceRegistry extends Context.Tag("SourceRegistry")<
  SourceRegistry,
  ISourceRegistry
>() {
  static readonly Live = Layer.succeed(this, makeRegistry([claudeCodeSourceAdapter]));

  /** Registry holding an explicit adapter set, for tests. */
  static readonly withAdapters = (
    adapters: readonly SourceAdapter[],
  ): Layer.Layer<SourceRegistry> => Layer.succeed(SourceRegistry, makeRegistry(adapters));
}

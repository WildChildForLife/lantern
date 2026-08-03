import { count, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DrizzleService } from "../../../lib/db/DrizzleService.ts";
import { projects, sessions } from "../../../lib/db/schema.ts";
import type { ControllerResponse } from "../../../lib/effect/toEffectResponse.ts";
import type { InferEffect } from "../../../lib/effect/types.ts";
import { EventBus } from "../../events/services/EventBus.ts";
import { FileWatcherService } from "../../events/services/fileWatcher.ts";
import { SyncService } from "../../sync/services/SyncService.ts";
import type { SourceId } from "../models/SourceId.ts";
import { SourceConfigService } from "../services/SourceConfigService.ts";
import { SourceRegistry } from "../services/SourceRegistry.ts";

const LayerImpl = Effect.gen(function* () {
  const registry = yield* SourceRegistry;
  const configService = yield* SourceConfigService;
  const syncService = yield* SyncService;
  const fileWatcher = yield* FileWatcherService;
  const eventBus = yield* EventBus;
  const { db } = yield* DrizzleService;

  const countsFor = (sourceId: SourceId) => {
    const projectCount =
      db.select({ value: count() }).from(projects).where(eq(projects.source, sourceId)).get()
        ?.value ?? 0;
    const sessionCount =
      db.select({ value: count() }).from(sessions).where(eq(sessions.source, sourceId)).get()
        ?.value ?? 0;

    return { projects: projectCount, sessions: sessionCount };
  };

  /**
   * Every adapter, whether or not it is enabled, with what was found on this
   * machine. A source that is installed but unreadable says so, rather than
   * being left out and looking unsupported.
   */
  const listSources = () =>
    Effect.gen(function* () {
      const config = yield* configService.get();

      const sources = yield* Effect.forEach(registry.all, (adapter) =>
        adapter.detect().pipe(
          Effect.map((detection) => ({
            id: adapter.id,
            displayName: adapter.displayName,
            enabled: config.enabled.includes(adapter.id),
            capabilities: adapter.capabilities,
            rootPath: detection.rootPath,
            hasData: detection.hasData,
            supported: detection.supported,
            unsupportedReason: detection.unsupportedReason,
            stats: countsFor(adapter.id),
          })),
        ),
      );

      return {
        status: 200,
        response: { sources },
      } as const satisfies ControllerResponse;
    });

  const setEnabledSources = (enabled: readonly SourceId[]) =>
    Effect.gen(function* () {
      const { added, removed } = yield* configService.setEnabled(enabled);

      // Reading a newly enabled source can take a while, so the response does
      // not wait for it. The client learns it finished from the SSE event.
      yield* Effect.forkDaemon(
        Effect.gen(function* () {
          for (const sourceId of removed) {
            yield* syncService.purgeSource(sourceId);
          }

          if (added.length > 0) {
            yield* syncService.fullSync(added);
          }

          yield* fileWatcher.reconcileWatchers();
          yield* eventBus.emit("sourcesChanged", {});
        }).pipe(
          Effect.catchAll((error) =>
            Effect.logError(`Failed to apply the source selection: ${String(error)}`),
          ),
        ),
      );

      return yield* listSources();
    });

  return { listSources, setEnabledSources };
});

export type ISourceController = InferEffect<typeof LayerImpl>;

export class SourceController extends Context.Tag("SourceController")<
  SourceController,
  ISourceController
>() {
  static readonly Live = Layer.effect(this, LayerImpl);
}

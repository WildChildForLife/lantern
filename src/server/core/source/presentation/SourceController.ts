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
      // An id can exist in the schema before its adapter does. Enabling one
      // would disable everything readable and leave no way back from the UI.
      const unknown = enabled.filter(
        (sourceId) => !registry.all.some((adapter) => adapter.id === sourceId),
      );
      if (unknown.length > 0) {
        return {
          status: 400,
          response: { error: `Lantern has no adapter for: ${unknown.join(", ")}` },
        } as const satisfies ControllerResponse;
      }

      const change = yield* configService.setEnabled(enabled).pipe(
        Effect.map((result) => ({ ok: true, result }) as const),
        Effect.catchTags({
          SourceSelectionLockedError: (error) =>
            Effect.succeed({ ok: false, reason: "locked", enabled: error.enabled } as const),
          SourceConfigWriteError: (error) =>
            Effect.succeed({ ok: false, reason: "write-failed", cause: error.cause } as const),
        }),
      );

      if (!change.ok) {
        // Nothing has been purged or synced yet, so refusing here leaves the
        // cache exactly as it was.
        return change.reason === "locked"
          ? ({
              status: 409,
              response: {
                error: `Sources were set on the command line for this run: ${change.enabled.join(", ")}`,
              },
            } as const satisfies ControllerResponse)
          : ({
              status: 500,
              response: { error: "Could not save the source selection" },
            } as const satisfies ControllerResponse);
      }

      const { added, removed } = change.result;

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

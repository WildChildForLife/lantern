import { FileSystem, Path } from "@effect/platform";
import { Context, Effect, Fiber, Layer, Ref, Stream } from "effect";
import { ApplicationContext } from "../../platform/services/ApplicationContext.ts";
import { encodeProjectId } from "../../project/functions/id.ts";
import type { SourceAdapter } from "../../source/models/SourceAdapter.ts";
import { SourceRegistry } from "../../source/services/SourceRegistry.ts";
import { EventBus } from "./EventBus.ts";

type FileWatcherServiceInterface = {
  readonly startWatching: () => Effect.Effect<void>;
  /** Starts watching newly enabled roots and drops the ones no longer read. */
  readonly reconcileWatchers: () => Effect.Effect<void>;
  readonly stop: () => Effect.Effect<void>;
};

export class FileWatcherService extends Context.Tag("FileWatcherService")<
  FileWatcherService,
  FileWatcherServiceInterface
>() {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const eventBus = yield* EventBus;
      const context = yield* ApplicationContext;
      const registry = yield* SourceRegistry;

      const sourceEnv = Layer.mergeAll(
        Layer.succeed(FileSystem.FileSystem, fs),
        Layer.succeed(Path.Path, path),
        Layer.succeed(ApplicationContext, context),
      );

      // One fiber per watched root, keyed by the root itself, so enabling or
      // disabling a source starts or interrupts only its own watcher.
      const watcherFibersRef = yield* Ref.make<Map<string, Fiber.RuntimeFiber<void, unknown>>>(
        new Map(),
      );
      const debounceTimersRef = yield* Ref.make<Map<string, ReturnType<typeof setTimeout>>>(
        new Map(),
      );

      const clearDebounceTimer = (debounceKey: string) =>
        Effect.gen(function* () {
          const timers = yield* Ref.get(debounceTimersRef);
          const timer = timers.get(debounceKey);
          if (timer !== undefined) {
            clearTimeout(timer);
            timers.delete(debounceKey);
            yield* Ref.set(debounceTimersRef, timers);
          }
        });

      const scheduleDebouncedEmit = (
        debounceKey: string,
        payload:
          | { type: "agent"; projectId: string; agentSessionId: string }
          | { type: "session"; projectId: string; sessionId: string },
      ) =>
        Effect.gen(function* () {
          yield* clearDebounceTimer(debounceKey);

          const timers = yield* Ref.get(debounceTimersRef);
          const timer = setTimeout(() => {
            if (payload.type === "agent") {
              Effect.runFork(
                eventBus.emit("agentSessionChanged", {
                  projectId: payload.projectId,
                  agentSessionId: payload.agentSessionId,
                }),
              );
            } else {
              Effect.runFork(
                eventBus.emit("sessionChanged", {
                  projectId: payload.projectId,
                  sessionId: payload.sessionId,
                }),
              );
              Effect.runFork(
                eventBus.emit("sessionListChanged", {
                  projectId: payload.projectId,
                }),
              );
            }

            void Effect.runPromise(clearDebounceTimer(debounceKey));
          }, 100);

          timers.set(debounceKey, timer);
          yield* Ref.set(debounceTimersRef, timers);
        });

      const handleWatchEvent = (
        adapter: SourceAdapter,
        roots: readonly string[],
        rootPath: string,
        changedPath: string,
      ) =>
        Effect.gen(function* () {
          const fullPath = path.isAbsolute(changedPath)
            ? changedPath
            : path.join(rootPath, changedPath);

          // The adapter decides what a path under its own roots means; the
          // watcher only owns the fibers and the debounce.
          const change = adapter.classifyChange(fullPath, roots);
          if (change === null) {
            return;
          }

          const encodedProjectId = encodeProjectId(change.projectStoragePath);

          if (change.agentId !== null) {
            yield* scheduleDebouncedEmit(`${encodedProjectId}/agent-${change.agentId}`, {
              type: "agent",
              projectId: encodedProjectId,
              agentSessionId: change.agentId,
            });
            return;
          }

          yield* scheduleDebouncedEmit(`${encodedProjectId}/${change.sessionId}`, {
            type: "session",
            projectId: encodedProjectId,
            sessionId: change.sessionId,
          });
        });

      const enabledRoots = () =>
        Effect.gen(function* () {
          const adapters = yield* registry.enabled();
          const byRoot = new Map<string, { adapter: SourceAdapter; roots: readonly string[] }>();

          for (const adapter of adapters) {
            if (!adapter.capabilities.watch) {
              continue;
            }
            const roots = yield* adapter.watchRoots().pipe(Effect.provide(sourceEnv));
            for (const root of roots) {
              byRoot.set(root, { adapter, roots });
            }
          }

          return byRoot;
        });

      const reconcileWatchers = (): Effect.Effect<void> =>
        Effect.gen(function* () {
          const wanted = yield* enabledRoots();
          const running = yield* Ref.get(watcherFibersRef);

          for (const [root, fiber] of running) {
            if (!wanted.has(root)) {
              yield* Effect.logInfo(`No longer watching: ${root}`);
              yield* Fiber.interrupt(fiber);
              running.delete(root);
            }
          }

          for (const [root, { adapter, roots }] of wanted) {
            if (running.has(root)) {
              continue;
            }

            yield* Effect.logInfo(`Starting file watcher on: ${root}`);

            // One root failing — a directory that does not exist, or an inotify
            // limit — must not take the other sources' watchers down with it.
            const fiber = yield* fs.watch(root, { recursive: true }).pipe(
              Stream.runForEach((event) => handleWatchEvent(adapter, roots, root, event.path)),
              Effect.catchAll((error) =>
                Effect.logError(`Stopped watching ${root}: ${String(error)}`),
              ),
              Effect.forkDaemon,
            );

            running.set(root, fiber);
          }

          yield* Ref.set(watcherFibersRef, running);
        }).pipe(
          Effect.catchAll((error) => {
            Effect.runFork(Effect.logError(`Failed to reconcile file watchers: ${String(error)}`));
            return Effect.void;
          }),
        );

      const startWatching = (): Effect.Effect<void> => reconcileWatchers();

      const stop = (): Effect.Effect<void> =>
        Effect.gen(function* () {
          const timers = yield* Ref.get(debounceTimersRef);
          for (const timer of timers.values()) {
            clearTimeout(timer);
          }
          yield* Ref.set(debounceTimersRef, new Map());

          const fibers = yield* Ref.get(watcherFibersRef);
          for (const fiber of fibers.values()) {
            yield* Fiber.interrupt(fiber);
          }
          yield* Ref.set(watcherFibersRef, new Map());
        });

      return {
        startWatching,
        reconcileWatchers,
        stop,
      } satisfies FileWatcherServiceInterface;
    }),
  );
}

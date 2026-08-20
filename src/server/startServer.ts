import { FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { createAdaptorServer, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Effect, Layer } from "effect";
import { AgentSessionLayer } from "./core/agent-session/index.ts";
import { AgentSessionController } from "./core/agent-session/presentation/AgentSessionController.ts";
import { SessionAllowlistRepository } from "./core/claude-code/infrastructure/SessionAllowlistRepository.ts";
import { AskUserQuestionController } from "./core/claude-code/presentation/AskUserQuestionController.ts";
import { ClaudeCodeController } from "./core/claude-code/presentation/ClaudeCodeController.ts";
import { ClaudeCodePermissionController } from "./core/claude-code/presentation/ClaudeCodePermissionController.ts";
import { ClaudeCodeSessionProcessController } from "./core/claude-code/presentation/ClaudeCodeSessionProcessController.ts";
import { AskUserQuestionService } from "./core/claude-code/services/AskUserQuestionService.ts";
import { BillingModeService } from "./core/claude-code/services/BillingModeService.ts";
import { ClaudeCodeLifeCycleService } from "./core/claude-code/services/ClaudeCodeLifeCycleService.ts";
import { ClaudeCodePermissionService } from "./core/claude-code/services/ClaudeCodePermissionService.ts";
import { ClaudeCodeService } from "./core/claude-code/services/ClaudeCodeService.ts";
import { ClaudeCodeSessionProcessService } from "./core/claude-code/services/ClaudeCodeSessionProcessService.ts";
import { ProjectSettingsService } from "./core/claude-code/services/ProjectSettingsService.ts";
import { SSEController } from "./core/events/presentation/SSEController.ts";
import { FileWatcherService } from "./core/events/services/fileWatcher.ts";
import { FeatureFlagController } from "./core/feature-flag/presentation/FeatureFlagController.ts";
import { FileSystemController } from "./core/file-system/presentation/FileSystemController.ts";
import { GitController } from "./core/git/presentation/GitController.ts";
import { GitService } from "./core/git/services/GitService.ts";
import { NotificationController } from "./core/notification/presentation/NotificationController.ts";
import { NotificationService } from "./core/notification/services/NotificationService.ts";
import { isDevelopmentEnv } from "./core/platform/runtimeEnv.ts";
import {
  type CliOptions,
  type StoredOptions,
  toLanternOptions,
} from "./core/platform/services/LanternOptionsService.ts";
import { ProjectRepository } from "./core/project/infrastructure/ProjectRepository.ts";
import { ProjectController } from "./core/project/presentation/ProjectController.ts";
import { ProjectMetaService } from "./core/project/services/ProjectMetaService.ts";
import { RateLimitAutoScheduleService } from "./core/rate-limit/services/RateLimitAutoScheduleService.ts";
import { SchedulerConfigBaseDir } from "./core/scheduler/config.ts";
import { SchedulerService } from "./core/scheduler/domain/Scheduler.ts";
import { SchedulerController } from "./core/scheduler/presentation/SchedulerController.ts";
import { SearchController } from "./core/search/presentation/SearchController.ts";
import { SearchService } from "./core/search/services/SearchService.ts";
import { SessionRepository } from "./core/session/infrastructure/SessionRepository.ts";
import { SessionController } from "./core/session/presentation/SessionController.ts";
import { SessionLocatorService } from "./core/session/services/SessionLocatorService.ts";
import { SessionMetaService } from "./core/session/services/SessionMetaService.ts";
import { TopicClassifierService } from "./core/session/services/TopicClassifierService.ts";
import { SourceConfigBaseDir } from "./core/source/config.ts";
import { SourceController } from "./core/source/presentation/SourceController.ts";
import { SourceConfigService } from "./core/source/services/SourceConfigService.ts";
import { SourceRegistry } from "./core/source/services/SourceRegistry.ts";
import { SyncService } from "./core/sync/services/SyncService.ts";
import { TasksController } from "./core/tasks/presentation/TasksController.ts";
import { TasksService } from "./core/tasks/services/TasksService.ts";
import { TerminalService } from "./core/terminal/TerminalService.ts";
import { honoApp } from "./hono/app.ts";
import { InitializeService } from "./hono/initialize.ts";
import { AuthMiddleware } from "./hono/middleware/auth.middleware.ts";
import { routes } from "./hono/routes/index.ts";
import { DrizzleService } from "./lib/db/DrizzleService.ts";
import { platformLayer } from "./lib/effect/layers.ts";
import { serverLoggerLayer, withServerLogLevel } from "./logging.ts";
import { setupTerminalWebSocket } from "./terminal/terminalWebSocket.ts";

export type StartServerOptions = {
  /**
   * Whether something else owns the screen — see `resolveLogLevel`.
   *
   * Set by the bare `lantern`, which runs the terminal board in this same
   * process the moment the server is up.
   */
  quiet?: boolean;
};

export type StartedServer = {
  server: ServerType;
  /** Where the server can be reached, port included, ready to print or open. */
  url: string;
};

/**
 * Starts the web server, and hands back the server it started.
 *
 * Resolves once the port is actually bound rather than once `listen` has been
 * called, so a caller can print the URL — or draw a board over it — knowing the
 * server behind it is answering. The returned server is what closes it again:
 * a bare `lantern` shuts it down when the board quits.
 */
export const startServer = async (
  options: CliOptions,
  stored?: StoredOptions,
  serverOptions?: StartServerOptions,
): Promise<StartedServer> => {
  // Resolved once, here, so the port and bind address the server listens on and
  // the ones every service reads come from the same precedence rules.
  const resolved = toLanternOptions(options, stored);
  const quiet = serverOptions?.quiet === true;

  const runWithLogger = <A, E>(effect: Effect.Effect<A, E, never>) =>
    Effect.runPromise(
      effect.pipe(withServerLogLevel(resolved.verbose, quiet), Effect.provide(serverLoggerLayer)),
    );

  // biome-ignore lint/style/noProcessEnv: allow only here
  // oxlint-disable-next-line node/no-process-env -- configuration boundary
  const isDevelopment = isDevelopmentEnv(process.env.LANTERN_ENV);
  const apiOnly = resolved.apiOnly === true;

  if (!isDevelopment && !apiOnly) {
    const staticPath = await Effect.runPromise(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        return path.resolve(import.meta.dirname, "static");
      }).pipe(Effect.provide(NodeContext.layer)),
    );
    await runWithLogger(Effect.logInfo(`Serving static files from ${staticPath}`));
    const indexHtml = await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        return yield* fs.readFileString(path.resolve(staticPath, "index.html"));
      }).pipe(Effect.provide(NodeContext.layer)),
    );

    honoApp.use(
      "/*",
      serveStatic({
        root: staticPath,
      }),
    );

    honoApp.use("*", async (c, next) => {
      if (c.req.path.startsWith("/api")) {
        return next();
      }

      return c.html(indexHtml);
    });
  }

  const server = createAdaptorServer({
    fetch: honoApp.fetch,
  });

  const program = Effect.gen(function* () {
    yield* routes(honoApp, options, stored);
    if (!apiOnly) {
      yield* setupTerminalWebSocket(server);
    }
  })
    // Layers must be piped into the container from the shallowest dependency up
    .pipe(Effect.provide(MainLayer), Effect.scoped);

  // The level is set around the whole program, not only the two lines below:
  // the background fibers the layers fork — the sync, the file watcher — copy
  // it as they are forked, and they are the ones that would otherwise write
  // over the board long after start-up is done.
  await Effect.runPromise(program.pipe(withServerLogLevel(resolved.verbose, quiet)));

  const port = isDevelopment
    ? // biome-ignore lint/style/noProcessEnv: allow only here
      // oxlint-disable-next-line node/no-process-env -- configuration boundary
      Number.parseInt(process.env.DEV_BE_PORT ?? "3401", 10)
    : resolved.port;

  const url = await new Promise<string>((resolve) => {
    server.listen(port, resolved.hostname, () => {
      const info = server.address();
      const serverPort = typeof info === "object" && info !== null ? info.port : port;
      const mode = apiOnly ? " (API-only mode)" : "";
      const address = `http://${resolved.hostname}:${serverPort}`;
      void runWithLogger(Effect.logInfo(`Server is running on ${address}${mode}`));
      resolve(address);
    });
  });

  return { server, url };
};

/** Stops a server started by `startServer`, and waits for it to be stopped. */
export const stopServer = (server: ServerType): Promise<void> =>
  new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });

const PlatformLayer = Layer.mergeAll(platformLayer, NodeContext.layer);

const InfraBasics = Layer.mergeAll(
  ProjectMetaService.Live,
  SessionMetaService.Live,
  SessionAllowlistRepository.Live,
).pipe(
  Layer.provideMerge(SyncService.Live),
  Layer.provideMerge(SourceRegistry.Live),
  Layer.provideMerge(SourceConfigService.Live),
  Layer.provideMerge(SourceConfigBaseDir.Live),
  Layer.provideMerge(DrizzleService.Live),
);

const InfraRepos = Layer.mergeAll(
  ProjectRepository.Live,
  SessionRepository.Live.pipe(Layer.provideMerge(SessionLocatorService.Live)),
  TopicClassifierService.Live,
).pipe(Layer.provideMerge(InfraBasics));

const InfraLayer = AgentSessionLayer.pipe(Layer.provideMerge(InfraRepos));

const DomainBase = Layer.mergeAll(
  AskUserQuestionService.Live,
  ClaudeCodePermissionService.Live,
  ClaudeCodeSessionProcessService.Live,
  ClaudeCodeService.Live,
  BillingModeService.Live,
  GitService.Live,
  NotificationService.Live,
  SchedulerService.Live,
  SchedulerConfigBaseDir.Live,
  SearchService.Live,
  TasksService.Live,
).pipe(Layer.provideMerge(ProjectSettingsService.Live));

const DomainLayer = ClaudeCodeLifeCycleService.Live.pipe(Layer.provideMerge(DomainBase));

const AppServices = Layer.mergeAll(
  FileWatcherService.Live,
  RateLimitAutoScheduleService.Live,
  AuthMiddleware.Live,
  TerminalService.Live,
);

const ApplicationLayer = InitializeService.Live.pipe(Layer.provideMerge(AppServices));

const PresentationLayer = Layer.mergeAll(
  ProjectController.Live,
  SessionController.Live,
  SourceController.Live,
  AgentSessionController.Live,
  GitController.Live,
  ClaudeCodeController.Live,
  ClaudeCodeSessionProcessController.Live,
  AskUserQuestionController.Live,
  ClaudeCodePermissionController.Live,
  FileSystemController.Live,
  SSEController.Live,
  NotificationController.Live,
  SchedulerController.Live,
  FeatureFlagController.Live,
  SearchController.Live,
  TasksController.Live,
);

const MainLayer = PresentationLayer.pipe(
  Layer.provideMerge(ApplicationLayer),
  Layer.provideMerge(DomainLayer),
  Layer.provideMerge(InfraLayer),
  Layer.provideMerge(PlatformLayer),
);

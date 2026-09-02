import { zValidator } from "@hono/zod-validator";
import { Effect, Runtime } from "effect";
import { setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import prexit from "prexit";
import packageJson from "../../../../package.json" with { type: "json" };
import {
  LanternOptionsService,
  type CliOptions,
  type StoredOptions,
} from "../../core/platform/services/LanternOptionsService.ts";
import { UserConfigService } from "../../core/platform/services/UserConfigService.ts";
import { userConfigSchema } from "../../lib/config/config.ts";
import type { HonoAppType, HonoContext } from "../app.ts";
import { InitializeService } from "../initialize.ts";
import { AuthMiddleware } from "../middleware/auth.middleware.ts";
import { configMiddleware } from "../middleware/config.middleware.ts";
import { getHonoRuntime } from "../runtime.ts";
import { authRoutes } from "./authRoutes.ts";
import { claudeCodeRoutes } from "./claudeCodeRoutes.ts";
import { conversationRoutes } from "./conversationRoutes.ts";
import { featureFlagRoutes } from "./featureFlagRoutes.ts";
import { fileSystemRoutes } from "./fileSystemRoutes.ts";
import { notificationRoutes } from "./notificationRoutes.ts";
import { projectRoutes } from "./projectRoutes.ts";
import { schedulerRoutes } from "./schedulerRoutes.ts";
import { searchRoutes } from "./searchRoutes.ts";
import { sourceRoutes } from "./sourceRoutes.ts";
import { sseRoutes } from "./sseRoutes.ts";
import { tasksRoutes } from "./tasksRoutes.ts";

const API_ONLY_ALLOWED_PREFIXES = [
  "/api/version",
  "/api/config",
  "/api/projects",
  "/api/conversations",
  "/api/claude-code",
  "/api/search",
  "/api/notifications",
  "/api/sse",
  "/api/sources",
];

const createApiOnlyMiddleware = (apiOnly: boolean) =>
  createMiddleware<HonoContext>(async (c, next) => {
    if (apiOnly) {
      const path = c.req.path;
      const allowed = API_ONLY_ALLOWED_PREFIXES.some(
        (prefix) => path === prefix || path.startsWith(`${prefix}/`),
      );
      if (!allowed) {
        return c.json({ error: "Not Found" }, 404);
      }
    }
    return next();
  });

export const routes = (app: HonoAppType, options: CliOptions, stored?: StoredOptions) =>
  Effect.gen(function* () {
    const optionsService = yield* LanternOptionsService;
    yield* optionsService.loadCliOptions(options, stored);

    const userConfigService = yield* UserConfigService;
    const initializeService = yield* InitializeService;

    const { authRequiredMiddleware } = yield* AuthMiddleware;
    const apiOnly = (yield* optionsService.getOption("apiOnly")) === true;
    const apiOnlyMiddleware = createApiOnlyMiddleware(apiOnly);

    const runtime = yield* getHonoRuntime;

    yield* initializeService.startInitialization();

    prexit(async () => {
      await Runtime.runPromise(runtime)(initializeService.stopCleanup());
    });

    return (
      app
        // middleware
        .use(configMiddleware)
        .use(apiOnlyMiddleware)
        .use(async (c, next) => {
          await Runtime.runPromise(
            runtime,
            userConfigService.setUserConfig({
              ...c.get("userConfig"),
            }),
          );

          await next();
        })

        /**
         * Auth un-necessary Routes
         *
         * `/api/version` has to stay above `authRequiredMiddleware`. A second
         * `lantern` asks this route what is on the port before it binds one, and
         * it has no password to offer — see `probeUrl` in
         * `src/cli/serverPresence.ts`. Behind auth it would answer 401, and the
         * second launch would report a stranger on the port rather than opening
         * a board against the Lantern that is there.
         */
        .get("/api/version", (c) => {
          return c.json({
            version: packageJson.version,
          });
        })

        .route("/api/auth", yield* authRoutes)

        .use(authRequiredMiddleware)

        /**
         * Private Routes
         */
        .get("/api/config", (c) => {
          return c.json({
            config: c.get("userConfig"),
          });
        })
        .put("/api/config", zValidator("json", userConfigSchema), (c) => {
          const { ...config } = c.req.valid("json");

          setCookie(c, "lantern-config", JSON.stringify(config));

          return c.json({
            config,
          });
        })

        // core routes
        .route("/api/projects", yield* projectRoutes)
        .route("/api/conversations", yield* conversationRoutes)
        .route("/api/claude-code", yield* claudeCodeRoutes)
        .route("/api/scheduler", yield* schedulerRoutes)
        .route("/api/file-system", yield* fileSystemRoutes)
        .route("/api/search", yield* searchRoutes)
        .route("/api/feature-flags", yield* featureFlagRoutes)
        .route("/api/sources", yield* sourceRoutes)
        .route("/api/tasks", yield* tasksRoutes)
        .route("/api/notifications", yield* notificationRoutes)
        .route("/api/sse", yield* sseRoutes)
    );
  });

export type RouteType =
  ReturnType<typeof routes> extends Effect.Effect<infer A, unknown, unknown> ? A : never;

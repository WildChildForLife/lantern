import { NodeContext } from "@effect/platform-node";
import { Layer } from "effect";
import { EventBus } from "../server/core/events/services/EventBus.ts";
import { ApplicationContext } from "../server/core/platform/services/ApplicationContext.ts";
import { EnvService } from "../server/core/platform/services/EnvService.ts";
import {
  type CliOptions,
  LanternOptionsService,
  type StoredOptions,
} from "../server/core/platform/services/LanternOptionsService.ts";
import { UserConfigService } from "../server/core/platform/services/UserConfigService.ts";

/**
 * The server's `platformLayer`, with the options already loaded.
 *
 * The server can afford to load its options after the layers are built,
 * because everything that matters to it reads them per request. A CLI command
 * cannot: it builds the graph, asks one question and exits, so a service that
 * resolved a path while it was being constructed — the source roots, the cache
 * file — would have done so before `--claude-dir` was ever seen. Handing the
 * options in up front is what makes the flag mean the same thing here as it
 * does on the server.
 */
export const cliPlatformLayer = (options: CliOptions, stored: StoredOptions) => {
  const optionsLayer = LanternOptionsService.withOptions(options, stored);

  return Layer.mergeAll(
    ApplicationContext.Live,
    UserConfigService.Live,
    EventBus.Live,
    EnvService.Live,
    optionsLayer,
  ).pipe(
    Layer.provide(EnvService.Live),
    Layer.provide(optionsLayer),
    Layer.provide(NodeContext.layer),
  );
};

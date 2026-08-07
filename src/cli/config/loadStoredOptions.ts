import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { EnvService } from "../../server/core/platform/services/EnvService.ts";
import type { CliConfig } from "./cliConfig.ts";
import { CliConfigBaseDir, readCliConfig } from "./cliConfigStore.ts";

/**
 * Reads `~/.lantern/config.json` on its own, before any of Lantern's layers
 * exist.
 *
 * The settings decide the port the server binds and the directory the cache
 * lives in, both of which are needed to build those layers — so this one read
 * has to stand outside them.
 */
export const loadStoredOptions = (): Promise<CliConfig> =>
  Effect.runPromise(
    readCliConfig.pipe(
      Effect.provide(CliConfigBaseDir.Live),
      Effect.provide(EnvService.Live),
      Effect.provide(NodeContext.layer),
    ),
  );

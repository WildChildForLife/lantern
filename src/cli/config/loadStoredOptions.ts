import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { EnvService } from "../../server/core/platform/services/EnvService.ts";
import { serverLoggerLayer } from "../../server/logging.ts";
import { noticeOnce } from "../notice.ts";
import type { CliConfig } from "./cliConfig.ts";
import { CliConfigBaseDir, readCliConfigResult } from "./cliConfigStore.ts";
import { describeUnreadableSettings } from "./describeUnreadableSettings.ts";

/**
 * Reads `~/.lantern/config.json` on its own, before any of Lantern's layers
 * exist.
 *
 * The settings decide the port the server binds and the directory the cache
 * lives in, both of which are needed to build those layers — so this one read
 * has to stand outside them.
 *
 * It is also where a file that could not be read is mentioned, because this is
 * the read whose answer is actually used. Said through `noticeOnce`, so the
 * launches that load settings more than once still only say it the once.
 *
 * The logger is provided even though nothing here logs on purpose: without it
 * anything that did would land as Effect's raw `timestamp=… level=… fiber=…`
 * frame, which is not a thing to show somebody who typed one word.
 */
export const loadStoredOptions = (): Promise<CliConfig> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* readCliConfigResult;

      if (result.unreadable) {
        yield* Effect.sync(() => noticeOnce(describeUnreadableSettings(result.configPath)));
      }

      return result.config;
    }).pipe(
      Effect.provide(CliConfigBaseDir.Live),
      Effect.provide(EnvService.Live),
      Effect.provide(NodeContext.layer),
      Effect.provide(serverLoggerLayer),
    ),
  );

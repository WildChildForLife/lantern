import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { EnvService } from "../../server/core/platform/services/EnvService.ts";
import { readSourceConfig, SourceConfigBaseDir } from "../../server/core/source/config.ts";
import type { SourceId } from "../../server/core/source/models/SourceId.ts";

/**
 * The agent CLIs already chosen, for the wizard to start from.
 *
 * Without this, re-running `init` would offer whatever is merely *detected* and
 * quietly overwrite a selection the user had narrowed on purpose.
 */
export const loadEnabledSources = (): Promise<SourceId[]> =>
  Effect.runPromise(
    readSourceConfig.pipe(
      Effect.map((config) => [...config.enabled]),
      Effect.catchAll(() => Effect.succeed<SourceId[]>([])),
      Effect.provide(SourceConfigBaseDir.Live),
      Effect.provide(EnvService.Live),
      Effect.provide(NodeContext.layer),
    ),
  );

import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { EnvService } from "../server/core/platform/services/EnvService.ts";
import type { CliConfig } from "./config/cliConfig.ts";
import { CliConfigBaseDir, cliConfigExists } from "./config/cliConfigStore.ts";
import { loadStoredOptions } from "./config/loadStoredOptions.ts";
import { shouldRunWizard } from "./firstRun.ts";

const configExists = (): Promise<boolean> =>
  Effect.runPromise(
    cliConfigExists.pipe(
      Effect.provide(CliConfigBaseDir.Live),
      Effect.provide(EnvService.Live),
      Effect.provide(NodeContext.layer),
    ),
  );

/**
 * Runs setup once, on the first launch that has somebody watching.
 *
 * Returns the settings to start with either way: the wizard's answers when it
 * ran, whatever is already stored when it did not.
 */
export const maybeRunFirstRunWizard = async (
  claudeDir: string | undefined,
  initAllowed: boolean,
): Promise<CliConfig> => {
  const wanted = shouldRunWizard({
    configExists: await configExists(),
    isInteractive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    noInit: !initAllowed,
    // biome-ignore lint/style/noProcessEnv: allow only here
    // oxlint-disable-next-line node/no-process-env -- configuration boundary
    env: process.env,
  });

  if (!wanted) {
    return loadStoredOptions();
  }

  const { runInit } = await import("./init/initCommand.tsx");

  return (await runInit({ claudeDir })) ?? (await loadStoredOptions());
};

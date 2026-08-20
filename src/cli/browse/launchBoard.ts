import type { SharedCommandOptions } from "../commandOptions.ts";
import type { CliConfig } from "../config/cliConfig.ts";

/**
 * Loads the terminal board and runs it, from either of the two commands that
 * start one — a bare `lantern` and `lantern browse`.
 *
 * The import is deferred on purpose. Ink and React are a megabyte of bundle
 * that `lantern --server-only`, `lantern init` and `lantern upgrade` have no
 * use for, and keeping the one `import()` here is what stops a second caller
 * pulling them in eagerly by accident.
 */
export const launchBoard = async (
  options: SharedCommandOptions,
  stored: CliConfig,
): Promise<number> => {
  const { runBrowse } = await import("./browseCommand.tsx");

  return runBrowse(options, stored);
};

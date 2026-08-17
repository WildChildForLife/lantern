import type { Command } from "commander";
import { parseSharedOptions } from "./commandOptions.ts";
import { loadStoredOptions } from "./config/loadStoredOptions.ts";
import { describeExcessArguments } from "./excessArguments.ts";

/**
 * Turns leftover words away before the command they were typed at does anything.
 *
 * Commander would otherwise decide this itself, and its answer depends on a
 * setting it copies down from the root command — `copyInheritedSettings` carries
 * `allowExcessArguments` to every subcommand registered after it. The root
 * command has to allow them, because that is how a mistyped subcommand reaches
 * an error message that names it, so each subcommand has to say what it makes
 * of them rather than inherit an answer meant for somebody else.
 *
 * Returns whether the caller should stop.
 */
const rejectExcessArguments = (program: Command, command: Command): boolean => {
  const problem = describeExcessArguments(command.args, `${program.name()} ${command.name()}`);

  if (problem === null) {
    return false;
  }

  process.stderr.write(`${problem}\n`);
  process.exitCode = 1;

  return true;
};

/**
 * Registers Lantern's interactive subcommands.
 *
 * The commands live outside `src/server` and `src/web` on purpose: they render
 * a terminal UI with React, but they drive the backend's Effect services
 * directly, so neither module boundary fits them.
 *
 * Both are loaded on demand. Ink and React are a megabyte of bundle that
 * `lantern` on its own has no use for, and the server's start-up time is the
 * one people wait on.
 */
export const registerCliCommands = (program: Command): void => {
  program
    .command("init")
    .description("set Lantern up interactively, and remember the answers")
    .option("--claude-dir <claude-dir>", "path to the claude directory to read")
    .allowExcessArguments()
    .action(async (_options: unknown, command: Command) => {
      if (rejectExcessArguments(program, command)) {
        return;
      }

      const { runInit } = await import("./init/initCommand.tsx");
      const config = await runInit(parseSharedOptions(command.optsWithGlobals()));
      process.exitCode = config === null ? 1 : 0;
    });

  program
    .command("browse")
    .alias("b")
    .description("browse conversations by topic, without leaving the terminal")
    .option("--claude-dir <claude-dir>", "path to the claude directory to read")
    .option("-e, --executable <executable>", "path to the claude code executable")
    .option("-v, --verbose", "enable verbose debug logging")
    .option(
      "--source <id>",
      "agent CLI to read sessions from; repeat for more than one",
      (value: string, previous: string[] | undefined) => [...(previous ?? []), value],
    )
    .allowExcessArguments()
    .action(async (_options: unknown, command: Command) => {
      if (rejectExcessArguments(program, command)) {
        return;
      }

      const { runBrowse } = await import("./browse/browseCommand.tsx");
      const exitCode = await runBrowse(
        parseSharedOptions(command.optsWithGlobals()),
        await loadStoredOptions(),
      );
      process.exitCode = exitCode;
    });

  program
    .command("upgrade")
    .description("upgrade Lantern where it was installed, or say what would")
    .option("--check", "report what is available, without changing anything")
    .option("--dry-run", "print the command that would run, without running it")
    .allowExcessArguments()
    .action(async (_options: unknown, command: Command) => {
      if (rejectExcessArguments(program, command)) {
        return;
      }

      const { parseUpgradeOptions, runUpgrade } = await import("./upgrade/upgradeCommand.ts");

      // `opts()`, not `optsWithGlobals()`: these two flags belong to this
      // command alone, so unlike the shared options there is nothing on the
      // root command to merge in.
      process.exitCode = await runUpgrade(parseUpgradeOptions(command.opts()));
    });
};

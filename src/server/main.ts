#!/usr/bin/env node
import { Command } from "commander";
import packageJson from "../../package.json" with { type: "json" };
import { maybeRunFirstRunWizard } from "../cli/firstRunWizard.ts";
import { registerCliCommands } from "../cli/index.ts";
import { describeUnknownCommand } from "../cli/unknownCommand.ts";
import { maybeNotifyUpdate } from "../cli/update/notifyUpdate.ts";
import type { CliOptions } from "./core/platform/services/LanternOptionsService.ts";
import { checkNodeVersion } from "./nodeVersionCheck.ts";
import { startServer } from "./startServer.ts";

checkNodeVersion();

const program = new Command();

// The npm package is `lantern-viewer`, because homebrew-cask already ships an
// unrelated `lantern` — but the command it installs is `lantern`, and that is
// what help text and error messages have to print for them to be paste-able.
const [commandName = packageJson.name] = Object.keys(packageJson.bin);

program.name(commandName).version(packageJson.version).description(packageJson.description);

// start server
program
  .option("-p, --port <port>", "port to listen on")
  .option("-h, --hostname <hostname>", "hostname to listen on")
  .option("-v, --verbose", "enable verbose debug logging")
  .option("-P, --password <password>", "password to authenticate")
  .option("-e, --executable <executable>", "path to claude code executable")
  .option("--claude-dir <claude-dir>", "path to claude directory")
  .option("--terminal-disabled", "disable the in-app terminal panel when enabled")
  .option("--terminal-shell <path>", "shell executable for terminal sessions")
  .option("--terminal-unrestricted", "disable restricted shell flags for bash sessions")
  .option("--api-only", "run in API-only mode without Web UI")
  .option("--no-init", "never offer the setup wizard on a first launch")
  .option(
    "--source <id>",
    "agent CLI to read sessions from; repeat for more than one",
    (value: string, previous: string[] | undefined) => [...(previous ?? []), value],
  )
  // Commander would otherwise reject a mistyped subcommand as one argument too
  // many, in those words. Taking the arguments instead lets the action say
  // which word it did not know — see `describeUnknownCommand`.
  .allowExcessArguments()
  .action(async (options: CliOptions & { init?: boolean }, command: Command) => {
    const unknown = describeUnknownCommand(
      command.args,
      command.commands.map((sub) => ({ name: sub.name(), aliases: sub.aliases() })),
      command.name(),
    );

    if (unknown !== null) {
      process.stderr.write(`${unknown}\n`);
      process.exitCode = 1;
      return;
    }

    // A first launch at a terminal walks through setup, then carries straight
    // on into starting the server with the answers. Anything without a
    // terminal — a container, CI, a pipe — skips it silently.
    const stored = await maybeRunFirstRunWizard(options.claudeDir, options.init !== false);

    await startServer(options, stored);
  });

registerCliCommands(program);

const main = async () => {
  // Before the command runs, so the line lands in the scrollback rather than
  // inside the alternate screen `browse` is about to take. It reads a cached
  // answer and never waits on the network — the request that refreshes that
  // cache is left running behind whatever starts next.
  await maybeNotifyUpdate(
    process.argv,
    // stderr, because that is where the notice goes: `lantern | tee` is still
    // somebody sitting at a terminal, and a redirected stdout is not a reason
    // to keep quiet about a new version.
    process.stderr.isTTY === true,
    // oxlint-disable-next-line no-process-env
    process.env,
    Date.now(),
  );

  await program.parseAsync(process.argv);
};

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});

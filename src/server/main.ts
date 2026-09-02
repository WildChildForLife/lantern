#!/usr/bin/env node
import { Command } from "commander";
import packageJson from "../../package.json" with { type: "json" };
import { launchBoard } from "../cli/browse/launchBoard.ts";
import { parseSharedOptions } from "../cli/commandOptions.ts";
import { loadStoredOptions } from "../cli/config/loadStoredOptions.ts";
import { describeCrash } from "../cli/crash.ts";
import { maybeRunFirstRunWizard } from "../cli/firstRunWizard.ts";
import { registerCliCommands } from "../cli/index.ts";
import { describeParseProblem } from "../cli/parseProblem.ts";
import { describeRunModeConflict, resolveRunMode } from "../cli/runMode.ts";
import {
  describeAlreadyServing,
  describePortOccupied,
  describePortTaken,
  resolveServerPlan,
} from "../cli/serverPlan.ts";
import { probeServerPresence, serverUrl } from "../cli/serverPresence.ts";
import { describeUnknownCommand } from "../cli/unknownCommand.ts";
import { maybeNotifyUpdate } from "../cli/update/notifyUpdate.ts";
import type { CliOptions } from "./core/platform/services/LanternOptionsService.ts";
import { checkNodeVersion } from "./nodeVersionCheck.ts";
import { isPortInUse, resolveServerAddress, startServer, stopServer } from "./startServer.ts";

checkNodeVersion();

const program = new Command();

// The npm package is `lantern-viewer`, because homebrew-cask already ships an
// unrelated `lantern` — but the command it installs is `lantern`, and that is
// what help text and error messages have to print for them to be paste-able.
const [commandName = packageJson.name] = Object.keys(packageJson.bin);

program.name(commandName).version(packageJson.version).description(packageJson.description);

// Commander opens every complaint of its own with `error:` — an unknown flag, a
// flag whose value is missing. Rewriting them here catches all of them at once,
// including the ones no code of Lantern's ever sees, and the subcommands
// registered below inherit this along with the rest of the root's settings.
program.configureOutput({
  outputError: (text, write) => {
    write(`${describeParseProblem(text, program.name())}\n`);
  },
});

// Start the web server and the terminal board together — see `resolveRunMode`.
program
  .option("--cli-only", "only browse in the terminal, without starting the web server")
  .option("--server-only", "only start the web server, without the terminal board")
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
  .action(
    async (
      options: CliOptions & { init?: boolean; cliOnly?: boolean; serverOnly?: boolean },
      command: Command,
    ) => {
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

      const mode = resolveRunMode({
        cliOnly: options.cliOnly === true,
        serverOnly: options.serverOnly === true,
        // Both halves, because the board draws on one and reads keys from the
        // other. `lantern | tee` has a terminal to read from and nowhere to
        // draw, and it has always started a server rather than a board.
        interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
      });

      if (mode === "conflict") {
        process.stderr.write(`${describeRunModeConflict(command.name())}\n`);
        process.exitCode = 1;
        return;
      }

      // The board alone is the one route that does not offer setup, exactly as
      // `lantern browse` never has: every question the wizard asks is about a
      // server this run is not going to start, and the board's own settings all
      // have a working default.
      if (mode === "cli") {
        process.exitCode = await launchBoard(
          parseSharedOptions(options),
          await loadStoredOptions(),
        );
        return;
      }

      // A first launch at a terminal walks through setup, then carries straight
      // on into starting the server with the answers. Anything without a
      // terminal — a container, CI, a pipe — skips it silently.
      const stored = await maybeRunFirstRunWizard(options.claudeDir, options.init !== false);

      // One web server at a time. A second `lantern` in a second terminal used
      // to reach `listen` and fall over on the port the first one holds; now it
      // asks what is there first, and the board it opens reads the cache
      // directly, so it never wanted a server of its own.
      const { hostname, port } = resolveServerAddress(options, stored);
      const presence = await probeServerPresence(hostname, port);

      if (resolveServerPlan({ mode, presence }) === "blocked") {
        process.stderr.write(
          `${
            presence === "lantern"
              ? describeAlreadyServing(hostname, port, command.name())
              : describePortOccupied(hostname, port, command.name())
          }\n`,
        );
        process.exitCode = 1;
        return;
      }

      if (resolveServerPlan({ mode, presence }) === "attach") {
        // Said the same way a launch that started one says it, because from
        // here on this is the same Lantern: the board is about to draw, and the
        // address is what the scrollback keeps.
        process.stderr.write(`Web UI: ${serverUrl(hostname, port)} (already running)\n`);

        // Exited rather than returned for the same reason the both-mode path
        // below exits: the board's own cache connection would keep the process
        // alive with nothing left to do. No `stopServer` — the server belongs
        // to the terminal that started it, and quitting this board must leave
        // it serving.
        process.exit(await launchBoard(parseSharedOptions(options), stored));
      }

      // Between the question above and the bind below, somebody else can take
      // the port — and only the bind can prove the port is held, so this is
      // where a wrong answer above is caught.
      const started = await startServer(options, stored, {
        quiet: mode === "both",
      }).catch(async (error: unknown) => {
        if (!isPortInUse(error)) {
          throw error;
        }

        // Asked again, because two seconds have passed and the first answer is
        // now known to have been wrong about something. A `free` that a failed
        // bind has just disproved is not evidence of anything, so it gets the
        // message that claims nothing about the tenant.
        const found = await probeServerPresence(hostname, port);

        process.stderr.write(
          `${
            found === "lantern"
              ? describeAlreadyServing(hostname, port, command.name())
              : found === "occupied"
                ? describePortOccupied(hostname, port, command.name())
                : describePortTaken(hostname, port, command.name())
          }\n`,
        );

        // Exit rather than return. `startServer` builds its layers before it
        // binds, so by the time the bind fails the file watchers, the scheduler
        // and the cache connection are all running: returning here would print
        // the message and then sit there with nothing left to do, which is
        // worse than the crash this replaced. Nothing bound, so nothing to
        // stop.
        process.exit(1);
      });

      if (mode === "server") {
        return;
      }

      // Both. The server's own start-up line is silenced — the board is about
      // to draw over the row it would land on — so the address is printed here
      // instead, once, into the scrollback the board hands back on the way out.
      const { server, url } = started;
      process.stderr.write(`Web UI: ${url}\n`);

      const exitCode = await launchBoard(parseSharedOptions(options), stored);

      // Quitting the board quits Lantern: one command started both halves, so
      // one keypress stops both. The exit is explicit because closing the port
      // is not enough on its own — the file watchers and the cache connection
      // the server opened would keep the process alive with nothing left to do.
      await stopServer(server);
      process.exit(exitCode);
    },
  );

registerCliCommands(program);

// Each subcommand points at its own help rather than the program's, because the
// flag that was mistyped is one of theirs. Done here, over the finished list,
// so registering a command is never also a job of remembering to do this.
for (const subcommand of program.commands) {
  subcommand.configureOutput({
    outputError: (text, write) => {
      write(`${describeParseProblem(text, `${program.name()} ${subcommand.name()}`)}\n`);
    },
  });
}

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
  // Read from argv rather than the parsed options: whatever threw may well have
  // thrown before there were any, and this is the one message that has to work
  // no matter how early things went wrong.
  const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");

  process.stderr.write(`${describeCrash(error, verbose)}\n`);
  process.exit(1);
});

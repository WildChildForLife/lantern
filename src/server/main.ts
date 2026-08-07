#!/usr/bin/env node
import { Command } from "commander";
import packageJson from "../../package.json" with { type: "json" };
import type { CliOptions } from "./core/platform/services/LanternOptionsService.ts";
import { checkNodeVersion } from "./nodeVersionCheck.ts";
import { startServer } from "./startServer.ts";

checkNodeVersion();

const program = new Command();

program.name(packageJson.name).version(packageJson.version).description(packageJson.description);

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
  .option(
    "--source <id>",
    "agent CLI to read sessions from; repeat for more than one",
    (value: string, previous: string[] | undefined) => [...(previous ?? []), value],
  )
  .action(async (options: CliOptions) => {
    await startServer(options);
  });

/* Other Commands Here */

const main = async () => {
  await program.parseAsync(process.argv);
};

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});

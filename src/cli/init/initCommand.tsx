import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { render } from "ink";
import { EnvService } from "../../server/core/platform/services/EnvService.ts";
import { SourceConfigBaseDir, writeSourceConfig } from "../../server/core/source/config.ts";
import type { SharedCommandOptions } from "../commandOptions.ts";
import type { CliConfig } from "../config/cliConfig.ts";
import { CliConfigBaseDir, getCliConfigPath, writeCliConfig } from "../config/cliConfigStore.ts";
import { loadEnabledSources } from "../config/loadEnabledSources.ts";
import { loadStoredOptions } from "../config/loadStoredOptions.ts";
import { makeCliRuntime, resyncBoard } from "../runtime.ts";
import { detectEnvironment } from "./detect.ts";
import { InitWizard, type WizardAnswers } from "./InitWizard.tsx";

/** Where the wizard's two files live, both under `~/.lantern`. */
const configPaths = Effect.all({
  config: getCliConfigPath,
}).pipe(Effect.provide(CliConfigBaseDir.Live));

const persist = (answers: WizardAnswers, existing: CliConfig) =>
  Effect.gen(function* () {
    yield* writeSourceConfig({ enabled: answers.sources });

    const config: CliConfig = {
      ...existing,
      port: answers.port,
      hostname: answers.hostname,
      claudeDir: answers.claudeDir,
      executable: answers.executable,
      terminalDisabled: answers.terminalDisabled,
      // Not asked about here: what Enter does is switched on the board itself.
      browse: existing.browse,
    };

    yield* writeCliConfig(config);

    return { config, path: (yield* configPaths).config };
  }).pipe(
    Effect.provide(SourceConfigBaseDir.Live),
    Effect.provide(CliConfigBaseDir.Live),
    Effect.provide(EnvService.Live),
    Effect.provide(NodeContext.layer),
  );

/**
 * Walks the user through setup and writes the answers down.
 *
 * Returns the settings it wrote, so a first launch can carry straight on into
 * starting the server with them rather than asking the user to run it again.
 */
export const runInit = async (options: SharedCommandOptions): Promise<CliConfig | null> => {
  if (process.stdin.isTTY !== true) {
    process.stderr.write(
      "`lantern init` asks questions, so it needs an interactive terminal.\n" +
        "Every setting it writes has a working default, so Lantern runs without it.\n",
    );
    return null;
  }

  process.stdout.write("Looking at what is already on this machine…\n");
  const detection = await detectEnvironment(options.claudeDir);
  const existing = await loadStoredOptions();
  const enabledSources = await loadEnabledSources();

  const collected: { answers: WizardAnswers | null } = { answers: null };

  const instance = render(
    <InitWizard
      detection={detection}
      initial={{
        sources: enabledSources.length === 0 ? undefined : enabledSources,
        claudeDir: options.claudeDir ?? existing.claudeDir,
        executable: existing.executable,
        port: existing.port,
        hostname: existing.hostname,
        terminalDisabled: existing.terminalDisabled,
      }}
      onDone={(answers) => {
        collected.answers = answers;
      }}
    />,
  );

  await instance.waitUntilExit();

  const answers = collected.answers;
  if (answers === null) {
    process.stderr.write("Setup cancelled. Nothing was written.\n");
    return null;
  }

  const { config, path } = await Effect.runPromise(persist(answers, existing));

  if (answers.runSync) {
    process.stdout.write("Reading your conversation logs…\n");
    const runtime = makeCliRuntime({ claudeDir: config.claudeDir }, config);

    try {
      const board = await resyncBoard(runtime, undefined);
      process.stdout.write(
        `Found ${board.total} conversations across ${board.topics.length} topics.\n`,
      );
    } finally {
      // The read opened the cache; the wizard is about to exit, so close it.
      await runtime.dispose();
    }
  }

  process.stdout.write(
    [
      "",
      `Saved to ${path}`,
      `  agent CLIs   ${answers.sources.join(", ")}`,
      `  web UI       http://${answers.hostname}:${answers.port}`,
      `  terminal     ${answers.terminalDisabled ? "off" : "on"}`,
      "",
      "Next:",
      "  lantern          start the web UI",
      "  lantern browse   find a conversation from here",
      "",
    ].join("\n"),
  );

  return config;
};

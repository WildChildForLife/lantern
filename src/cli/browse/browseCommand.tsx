import { render } from "ink";
import type { ActionPlan } from "../actions/planAction.ts";
import {
  copyToClipboard,
  findEmulator,
  handOver,
  spawnDetached,
} from "../actions/runActionPlan.ts";
import type { SharedCommandOptions } from "../commandOptions.ts";
import type { CliConfig } from "../config/cliConfig.ts";
import { type BoardData, loadBoard, resyncBoard } from "../runtime.ts";
import { BrowseApp } from "./BrowseApp.tsx";
import type { Status } from "./components/StatusBar.tsx";

const writeOut = (text: string) => {
  process.stdout.write(text);
};

const readEnv = (): Record<string, string | undefined> =>
  // biome-ignore lint/style/noProcessEnv: allow only here
  // oxlint-disable-next-line node/no-process-env -- terminal detection boundary
  ({ ...process.env });

/** Carries out a plan that does not need the screen. */
const runPlan = async (plan: ActionPlan): Promise<Status> => {
  switch (plan.kind) {
    case "copy": {
      const copied = await copyToClipboard(plan.text, process.platform, readEnv(), writeOut);
      return copied
        ? { text: `Copied the ${plan.label}.`, tone: "ok" }
        : { text: `Could not reach a clipboard.`, tone: "error" };
    }
    case "spawn":
      spawnDetached(plan.binary, plan.args, plan.cwd);
      return { text: `Opening a new ${plan.binary} window…`, tone: "ok" };
    case "refused":
      return { text: `Cannot resume: ${plan.reason}.`, tone: "error" };
    // Both of these give up the screen, so they never reach here.
    case "print":
    case "handoff":
      return null;
    default:
      plan satisfies never;
      return null;
  }
};

export const runBrowse = async (
  options: SharedCommandOptions,
  stored: CliConfig,
): Promise<number> => {
  // Ink needs raw mode, which a pipe or a cron job cannot give it. Saying so
  // beats the stack trace Ink would otherwise print.
  if (process.stdin.isTTY !== true) {
    process.stderr.write(
      "lantern browse needs an interactive terminal. Run `lantern` for the web UI instead.\n",
    );
    return 1;
  }

  const cliOptions = {
    // The board never listens on anything; these only exist because the
    // options type is shared with the server.
    port: "",
    hostname: "",
    claudeDir: options.claudeDir,
    executable: options.executable,
    verbose: options.verbose,
    source: options.source,
  };

  let syncing = false;
  const data = await loadBoard(cliOptions, stored, () => {
    syncing = true;
    process.stderr.write("Reading your conversation logs for the first time…\n");
  });

  if (data.conversations.length === 0) {
    process.stderr.write(
      syncing
        ? "No conversations found. Check --claude-dir, or which sources are enabled.\n"
        : "No conversations found.\n",
    );
    return 1;
  }

  const emulator = await findEmulator(process.platform, readEnv());

  // Set from inside the app, acted on once Ink has given the terminal back. A
  // holder rather than a bare variable: assignment happens in a callback, and
  // narrowing does not follow it.
  const leaving: { plan: ActionPlan | null } = { plan: null };
  let board: BoardData = data;
  let refreshing = false;

  const refresh = () => {
    if (refreshing) {
      return;
    }
    refreshing = true;
    draw();
    void resyncBoard(cliOptions, stored).then((next) => {
      board = next;
      refreshing = false;
      draw();
    });
  };

  const element = () => (
    <BrowseApp
      topics={board.topics}
      conversations={board.conversations}
      total={board.total}
      interactiveSources={board.interactiveSources}
      executable={board.executable}
      defaultAction={stored.browse.resumeAction}
      terminalCommand={stored.browse.terminalCommand}
      emulator={emulator}
      platform={process.platform}
      now={new Date()}
      onRun={runPlan}
      onLeave={(plan) => {
        leaving.plan = plan;
      }}
      onRefresh={refresh}
      refreshing={refreshing}
    />
  );

  const draw = () => {
    instance.rerender(element());
  };

  const instance = render(element());

  await instance.waitUntilExit();

  const plan = leaving.plan;
  if (plan === null) {
    return 0;
  }

  if (plan.kind === "print") {
    process.stdout.write(`cd ${plan.cwd}\n${plan.text}\n`);
    return 0;
  }

  if (plan.kind === "handoff") {
    return handOver(plan.binary, plan.args, plan.cwd);
  }

  return 0;
};

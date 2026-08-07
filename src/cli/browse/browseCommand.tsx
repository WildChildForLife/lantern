import { render } from "ink";
import type { ActionPlan } from "../actions/planAction.ts";
import {
  copyToClipboard,
  directoryExists,
  findEmulator,
  handOver,
  spawnDetached,
} from "../actions/runActionPlan.ts";
import type { SharedCommandOptions } from "../commandOptions.ts";
import type { CliConfig, ResumeAction } from "../config/cliConfig.ts";
import { saveResumeAction } from "../config/cliConfigStore.ts";
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

/**
 * The one thing every resume needs: the conversation's own directory.
 *
 * `claude --resume` looks a session up under the directory it runs in, so a
 * folder that has since been deleted or moved has to be reported as such —
 * running anywhere else makes Claude Code say the conversation does not exist.
 */
const missingDirectory = async (plan: ActionPlan): Promise<Status> => {
  if (plan.kind === "copy" || plan.kind === "refused") {
    return null;
  }

  return (await directoryExists(plan.cwd))
    ? null
    : { text: `${plan.cwd} no longer exists, so it cannot be resumed there.`, tone: "error" };
};

/** Carries out a plan that does not need the screen. */
const runPlan = async (plan: ActionPlan): Promise<Status> => {
  const gone = await missingDirectory(plan);
  if (gone !== null) {
    return gone;
  }

  switch (plan.kind) {
    case "copy": {
      const copied = await copyToClipboard(plan.text, process.platform, readEnv(), writeOut);
      return copied
        ? { text: `Copied the ${plan.label}.`, tone: "ok" }
        : { text: `Could not reach a clipboard.`, tone: "error" };
    }
    case "spawn":
      // Deliberately "opening": the launcher backgrounds the emulator and
      // exits, so there is nothing left to ask whether the window appeared.
      await spawnDetached(plan.binary, plan.args, plan.cwd, process.platform);
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
  const failure: { text: string | null } = { text: null };

  const rememberEnterAction = (action: ResumeAction) => {
    // Best effort: a settings file that cannot be written must not stop the
    // board from using the new choice for the rest of the session.
    void saveResumeAction(action).catch(() => undefined);
  };

  const refresh = () => {
    if (refreshing) {
      return;
    }
    refreshing = true;
    failure.text = null;
    draw();
    void resyncBoard(cliOptions, stored)
      .then((next) => {
        board = next;
      })
      // A re-read that throws must not take the board with it: Node kills the
      // process on an unhandled rejection, and it would do so while Ink owns
      // the screen and stdin is still in raw mode.
      .catch((error: unknown) => {
        failure.text = `Could not re-read the logs: ${String(error)}`;
      })
      .finally(() => {
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
      onDefaultActionChange={rememberEnterAction}
      onRefresh={refresh}
      refreshing={refreshing}
      refreshError={failure.text}
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

  // Checked here as well as in runPlan: these two give the screen back first,
  // so they leave the app before anything has verified the directory.
  if ((plan.kind === "print" || plan.kind === "handoff") && !(await directoryExists(plan.cwd))) {
    process.stderr.write(
      `${plan.cwd} no longer exists.\nClaude Code finds a conversation by the directory it ran in, so it cannot be resumed from anywhere else.\n`,
    );
    return 1;
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

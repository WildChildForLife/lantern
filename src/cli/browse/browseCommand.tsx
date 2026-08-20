import { render } from "ink";
import { shellEscape } from "../../lib/shell/shellEscape.ts";
import { describeClassifyOutcome } from "../../lib/topics/classifyOutcome.ts";
import { describeMissingDirectory } from "../actions/describeMissingDirectory.ts";
import type { ActionPlan } from "../actions/planAction.ts";
import { copyToClipboard, directoryExists, handOver } from "../actions/runActionPlan.ts";
import type { SharedCommandOptions } from "../commandOptions.ts";
import type { CliConfig, ResumeAction } from "../config/cliConfig.ts";
import { saveResumeAction } from "../config/cliConfigStore.ts";
import {
  type BoardData,
  classifyBoard,
  type CliRuntime,
  loadBoard,
  makeCliRuntime,
  resyncBoard,
} from "../runtime.ts";
import { BrowseApp } from "./BrowseApp.tsx";
import type { PrintedCommand } from "./components/PrintedCommand.tsx";
import type { Status } from "./components/StatusBar.tsx";
import { describeClassifyStatus } from "./functions/classifyMessage.ts";
import type { ClassifyScopeKey } from "./functions/keymap.ts";
import { createRedraw, type Redraw } from "./functions/redraw.ts";

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
    : { text: `${describeMissingDirectory(plan.cwd, process.platform)}.`, tone: "error" };
};

/**
 * Carries out a plan that does not need the screen.
 *
 * `write` is Ink's writer, handed down from the board — see `onRun`. The clipboard
 * escape has to go out through the renderer that owns the screen, not underneath
 * it.
 */
const runPlan = async (plan: ActionPlan, write: (chunk: string) => void): Promise<Status> => {
  const gone = await missingDirectory(plan);
  if (gone !== null) {
    return gone;
  }

  switch (plan.kind) {
    case "copy": {
      const copied = await copyToClipboard(plan.text, process.platform, readEnv(), write);
      return copied
        ? { text: `Copied the ${plan.label}.`, tone: "ok" }
        : { text: `Could not reach a clipboard.`, tone: "error" };
    }
    case "refused":
      return { text: `Cannot resume: ${plan.reason}.`, tone: "error" };
    // The board shows the command itself; all this had to do was check that the
    // directory behind it is still there.
    case "print":
      return null;
    // Resuming borrows the screen, so it goes through resumeSession instead.
    case "handoff":
      return null;
    default:
      plan satisfies never;
      return null;
  }
};

/**
 * Runs the session, and says how it went.
 *
 * The board is suspended rather than gone by the time this is called, so the
 * answer is a status line for a board that is about to be drawn again — not the
 * process's own exit code, which is what this used to become.
 */
const resumeSession = async (plan: ActionPlan): Promise<Status> => {
  if (plan.kind !== "handoff") {
    return null;
  }

  // Checked again here, and not only when the board drew the row: a folder can
  // go between reading the logs and pressing R.
  const gone = await missingDirectory(plan);
  if (gone !== null) {
    return gone;
  }

  const exitCode = await handOver(plan.binary, plan.args, plan.cwd);

  return exitCode === 0
    ? { text: "Back from the session. Pick another conversation, or q to quit.", tone: "info" }
    : { text: `The session exited with code ${exitCode}.`, tone: "error" };
};

export const runBrowse = async (
  options: SharedCommandOptions,
  stored: CliConfig,
): Promise<number> => {
  // Ink needs raw mode, which a pipe or a cron job cannot give it. Saying so
  // beats the stack trace Ink would otherwise print.
  if (process.stdin.isTTY !== true) {
    process.stderr.write(
      "The Lantern board needs an interactive terminal. Run `lantern --server-only` for the web UI instead.\n",
    );
    return 1;
  }

  // No port and no hostname: the board listens on nothing, and an empty string
  // would win the precedence chain and resolve the port to NaN.
  const runtime = makeCliRuntime(
    {
      claudeDir: options.claudeDir,
      executable: options.executable,
      verbose: options.verbose,
      source: options.source,
    },
    stored,
  );

  try {
    return await runBoard(options, stored, runtime);
  } finally {
    // Built once for the whole session, so it is closed once too — the cache is
    // a real SQLite connection.
    await runtime.dispose();
  }
};

const runBoard = async (
  options: SharedCommandOptions,
  stored: CliConfig,
  runtime: CliRuntime,
): Promise<number> => {
  let syncing = false;
  const data = await loadBoard(runtime, options.verbose, () => {
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

  let board: BoardData = data;
  let refreshing = false;
  // Holders rather than bare variables: both are assigned from a callback, and
  // narrowing does not follow that.
  const shown: { command: PrintedCommand | null } = { command: null };
  const failure: { text: string | null } = { text: null };

  // Assigned once the board is rendered, because the redraw needs the instance and
  // the instance needs the element. Until then there is nothing to redraw.
  let redraw: Redraw | undefined;

  const rememberEnterAction = (action: ResumeAction) => {
    // Best effort: a settings file that cannot be written must not stop the
    // board from using the new choice for the rest of the session.
    void saveResumeAction(action).catch(() => undefined);
  };

  /**
   * Sorts conversations into topics, and says what the pass amounted to.
   *
   * The pass itself can take a while and costs a CLI call, so it is reported the
   * same way the web app reports it — through the shared outcome, so the terminal
   * cannot end up making a different claim about the same result.
   */
  const classify = async (scope: ClassifyScopeKey): Promise<Status> =>
    describeClassifyStatus(
      describeClassifyOutcome(await classifyBoard(runtime, options.verbose, scope), scope),
    );

  const refresh = () => {
    if (refreshing) {
      return;
    }
    refreshing = true;
    failure.text = null;
    redraw?.draw();
    void resyncBoard(runtime, options.verbose)
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
        redraw?.draw();
      });
  };

  const element = () => (
    <BrowseApp
      topics={board.topics}
      conversations={board.conversations}
      total={board.total}
      unclassified={board.unclassified}
      interactiveSources={board.interactiveSources}
      executable={board.executable}
      defaultAction={stored.browse.resumeAction}
      now={new Date()}
      onRun={runPlan}
      onResume={resumeSession}
      onClassify={classify}
      onDefaultActionChange={rememberEnterAction}
      onRefresh={refresh}
      refreshing={refreshing}
      refreshError={failure.text}
      printed={shown.command}
      onPrint={(next) => {
        // A fresh token even for the same command, so the panel blinks on every
        // `p` rather than only when the text happens to differ.
        shown.command = { ...next, token: (shown.command?.token ?? 0) + 1 };
        redraw?.draw();
      }}
    />
  );

  // The board owns the terminal from the top row down, on the same alternate
  // screen `less` and `vim` use, so quitting gives the user back the scrollback
  // they started with. Resuming a conversation suspends this rather than
  // unmounting it, which is what keeps the user's place on the board.
  const instance = render(element(), { alternateScreen: true });

  // Gated rather than called directly: every redraw here is reached from a
  // callback that can outlive a quit — see `createRedraw`.
  redraw = createRedraw(() => {
    instance.rerender(element());
  });

  await instance.waitUntilExit();
  redraw.stop();

  // The alternate screen has taken the board's output with it, including a
  // command the user asked to see. Printing it here is what makes `p` then `q`
  // leave something behind to paste — escaped, because pasting is the whole
  // point and a project directory can carry a space or worse.
  if (shown.command !== null) {
    writeOut(`cd ${shellEscape(shown.command.cwd)}\n${shown.command.text}\n`);
  }

  // A re-read that failed says so on the board while it is up; on the way out it
  // is the exit code that carries it.
  return failure.text === null ? 0 : 1;
};

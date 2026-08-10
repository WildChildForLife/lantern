import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useCallback, useMemo, useState } from "react";
import type { ConversationListEntry, TopicGroup } from "../../server/core/types.ts";
import { type ActionPlan, planAction } from "../actions/planAction.ts";
import { nextResumeAction, RESUME_ACTION_LABELS, type ResumeAction } from "../config/cliConfig.ts";
import { TextInput } from "../ui/prompts/TextInput.tsx";
import { theme } from "../ui/theme.ts";
import { Board } from "./components/Board.tsx";
import { HelpOverlay } from "./components/HelpOverlay.tsx";
import {
  type PrintedCommand,
  PRINTED_COMMAND_HEIGHT,
  PrintedCommandPanel,
} from "./components/PrintedCommand.tsx";
import { StatusBar, type Status } from "./components/StatusBar.tsx";
import { TwoPane } from "./components/TwoPane.tsx";
import { buildColumns } from "./functions/buildColumns.ts";
import { type BrowseMode, resolveKeyAction } from "./functions/keymap.ts";
import { resolveLayout } from "./functions/layout.ts";

export type BrowseAppProps = {
  topics: TopicGroup[];
  conversations: ConversationListEntry[];
  total: number;
  interactiveSources: string[];
  executable: string | undefined;
  defaultAction: ResumeAction;
  /** Remembers a new choice of what Enter does, so it survives the session. */
  onDefaultActionChange: (action: ResumeAction) => void;
  now: Date;
  /** Runs a plan that can be carried out without giving up the screen. */
  onRun: (plan: ActionPlan) => Promise<Status>;
  /**
   * Runs the session, with the terminal already handed over to it.
   *
   * Called inside Ink's terminal suspension: the board stops drawing but stays
   * mounted, so what it returns is a status for a board that still has the
   * user's place in it, not for a new one.
   */
  onResume: (plan: ActionPlan) => Promise<Status>;
  onRefresh: () => void;
  refreshing: boolean;
  /** Set when the last re-read failed, so the board can say so. */
  refreshError?: string | null | undefined;
  /**
   * The resume command on show, held by the caller.
   *
   * Owned there rather than here so that quitting can print it again on the
   * screen the user is left looking at — the board's own output goes with the
   * alternate screen.
   */
  printed?: PrintedCommand | null | undefined;
  onPrint?: ((printed: { cwd: string; text: string }) => void) | undefined;
};

const clamp = (value: number, max: number): number =>
  Math.min(Math.max(0, value), Math.max(0, max));

/**
 * The board, in a terminal.
 *
 * State is deliberately shallow — which column, which row, which overlay — and
 * every decision about what a key means lives in `resolveKeyAction`, so this
 * component is wiring rather than behaviour.
 */
export const BrowseApp = ({
  topics,
  conversations,
  total,
  interactiveSources,
  executable,
  defaultAction,
  onDefaultActionChange,
  now,
  onRun,
  onResume,
  onRefresh,
  refreshing,
  refreshError,
  printed,
  onPrint,
}: BrowseAppProps) => {
  const { exit, suspendTerminal } = useApp();
  const { stdout } = useStdout();
  const [columnIndex, setColumnIndex] = useState(0);
  const [rowIndex, setRowIndex] = useState(0);
  const [filter, setFilter] = useState("");
  const [mode, setMode] = useState<BrowseMode>("board");
  const [status, setStatus] = useState<Status>(null);
  const [enterAction, setEnterAction] = useState<ResumeAction>(defaultAction);

  const columns = useMemo(
    () => buildColumns({ topics, conversations, filter }),
    [topics, conversations, filter],
  );

  const width = stdout?.columns ?? 100;
  const height = stdout?.rows ?? 30;

  const layout = resolveLayout({
    width,
    height,
    topicCount: columns.length,
    reservedRows: printed === null || printed === undefined ? 0 : PRINTED_COMMAND_HEIGHT,
  });

  const safeColumnIndex = clamp(columnIndex, columns.length - 1);
  const activeColumn = columns[safeColumnIndex];
  const safeRowIndex = clamp(rowIndex, (activeColumn?.rows.length ?? 1) - 1);
  const activeRow = activeColumn?.rows[safeRowIndex];

  const buildPlan = useCallback(
    (action: ResumeAction): ActionPlan | null =>
      activeRow === undefined
        ? null
        : planAction({
            action,
            sessionId: activeRow.sessionId,
            cwd: activeRow.projectPath,
            executable,
            interactive: interactiveSources.includes(activeRow.source),
          }),
    [activeRow, executable, interactiveSources],
  );

  const runAction = useCallback(
    (action: ResumeAction) => {
      const plan = buildPlan(action);
      if (plan === null) {
        return;
      }

      // Resuming is the only thing that still needs the screen, and it borrows
      // it rather than taking it: the board stops drawing, the session runs in
      // its place, and the same board — same topic, same row, same filter — is
      // drawn again when the session ends. The logs are re-read on the way back,
      // because the conversation that just ended has grown.
      if (plan.kind === "handoff") {
        setStatus({ text: "Resuming…", tone: "info" });
        void suspendTerminal(async () => {
          setStatus(await onResume(plan));
        })
          .then(onRefresh)
          .catch((error: unknown) => {
            setStatus({ text: String(error), tone: "error" });
          });
        return;
      }

      setStatus({ text: "…", tone: "info" });
      // Same reason as the refresh path: an unhandled rejection here would kill
      // the process with the terminal still in raw mode.
      void onRun(plan)
        .then((result) => {
          setStatus(result);

          // Shown only once the directory behind it has been checked: a command
          // that cannot work is worse on screen than not printed at all.
          if (plan.kind === "print" && (result === null || result.tone !== "error")) {
            onPrint?.({ cwd: plan.cwd, text: plan.text });
          }
        })
        .catch((error: unknown) => {
          setStatus({ text: String(error), tone: "error" });
        });
    },
    [buildPlan, onPrint, onRefresh, onResume, onRun, suspendTerminal],
  );

  useInput((input, key) => {
    const action = resolveKeyAction({ input, ...key }, mode);
    if (action === null) {
      return;
    }

    switch (action.type) {
      case "quit":
        exit();
        return;
      case "move-column":
        setColumnIndex(clamp(safeColumnIndex + action.delta, columns.length - 1));
        setRowIndex(0);
        setStatus(null);
        return;
      case "move-row":
        setRowIndex(clamp(safeRowIndex + action.delta, (activeColumn?.rows.length ?? 1) - 1));
        setStatus(null);
        return;
      case "row-edge":
        setRowIndex(action.edge === "first" ? 0 : (activeColumn?.rows.length ?? 1) - 1);
        return;
      case "open-filter":
        setMode("filter");
        return;
      case "close-overlay":
        setMode("board");
        return;
      case "toggle-help":
        setMode("help");
        return;
      case "refresh":
        setStatus({ text: "Re-reading the logs…", tone: "info" });
        onRefresh();
        return;
      case "cycle-enter-action": {
        const following = nextResumeAction(enterAction);
        setEnterAction(following);
        onDefaultActionChange(following);
        setStatus({ text: `Enter now: ${RESUME_ACTION_LABELS[following]}`, tone: "info" });
        return;
      }
      case "run-chosen":
        runAction(enterAction);
        return;
      case "run":
        runAction(action.action);
        return;
      default:
        action satisfies never;
    }
  });

  const truncated = total > conversations.length;

  return (
    // The whole terminal, from the top row: the caller has already switched to
    // the alternate screen, and a fixed height is what pins the status bar to
    // the bottom of it instead of letting it float under the last column.
    <Box flexDirection="column" paddingX={1} height={Math.max(1, height - 1)}>
      <Box marginBottom={1}>
        <Text color={theme.accent} bold>
          Lantern
        </Text>
        <Text dimColor>
          {"  "}
          {columns.length} topics · {conversations.length} conversations
          {truncated ? ` of ${total}` : ""}
          {refreshing ? " · refreshing" : ""}
        </Text>
        <Text>
          <Text dimColor>{"  ·  enter: "}</Text>
          <Text color={theme.accent}>{RESUME_ACTION_LABELS[enterAction]}</Text>
          <Text dimColor> (e to change)</Text>
        </Text>
      </Box>

      {mode === "filter" ? (
        <Box marginBottom={1}>
          <Text color={theme.accent}>filter </Text>
          <TextInput
            initialValue={filter}
            onChange={setFilter}
            onSubmit={() => {
              setMode("board");
            }}
            onCancel={() => {
              setFilter("");
              setMode("board");
            }}
          />
        </Box>
      ) : null}

      {/* Takes the slack, so everything below it sits at the bottom of the screen. */}
      <Box flexDirection="column" flexGrow={1}>
        {columns.length === 0 ? (
          <Text color={theme.muted}>
            {filter === "" ? "No conversations found." : `Nothing matches "${filter}".`}
          </Text>
        ) : layout.mode === "board" ? (
          <Board
            columns={columns}
            layout={layout}
            columnIndex={safeColumnIndex}
            rowIndex={safeRowIndex}
            now={now}
          />
        ) : (
          <TwoPane
            columns={columns}
            layout={layout}
            columnIndex={safeColumnIndex}
            rowIndex={safeRowIndex}
            now={now}
          />
        )}
      </Box>

      {mode === "help" ? (
        <Box marginTop={1}>
          <HelpOverlay />
        </Box>
      ) : null}

      {printed === null || printed === undefined ? null : (
        // A clear line between the board and the command, so the command does
        // not read as another row of the table.
        <Box marginTop={1}>
          <PrintedCommandPanel printed={printed} width={Math.max(20, width - 2)} />
        </Box>
      )}

      <Box marginTop={1}>
        <StatusBar
          row={activeRow}
          status={
            refreshError === null || refreshError === undefined
              ? status
              : { text: refreshError, tone: "error" }
          }
          width={width}
        />
      </Box>
    </Box>
  );
};

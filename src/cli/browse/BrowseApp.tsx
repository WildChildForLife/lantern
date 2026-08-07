import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useCallback, useMemo, useState } from "react";
import type { ConversationListEntry, TopicGroup } from "../../server/core/types.ts";
import { type ActionPlan, planAction } from "../actions/planAction.ts";
import { nextResumeAction, RESUME_ACTION_LABELS, type ResumeAction } from "../config/cliConfig.ts";
import { TextInput } from "../ui/prompts/TextInput.tsx";
import { theme } from "../ui/theme.ts";
import { Board } from "./components/Board.tsx";
import { HelpOverlay } from "./components/HelpOverlay.tsx";
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
  terminalCommand: string | undefined;
  emulator: string | null;
  platform: NodeJS.Platform;
  now: Date;
  /** Runs a plan that can be carried out without giving up the screen. */
  onRun: (plan: ActionPlan) => Promise<Status>;
  /** Takes over: the caller unmounts and then acts on the plan. */
  onLeave: (plan: ActionPlan) => void;
  onRefresh: () => void;
  refreshing: boolean;
  /** Set when the last re-read failed, so the board can say so. */
  refreshError?: string | null | undefined;
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
  terminalCommand,
  emulator,
  platform,
  now,
  onRun,
  onLeave,
  onRefresh,
  refreshing,
  refreshError,
}: BrowseAppProps) => {
  const { exit } = useApp();
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

  const layout = resolveLayout({
    width: stdout?.columns ?? 100,
    height: stdout?.rows ?? 30,
    topicCount: columns.length,
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
            terminalCommand,
            interactive: interactiveSources.includes(activeRow.source),
            emulator,
            platform,
          }),
    [activeRow, executable, terminalCommand, interactiveSources, emulator, platform],
  );

  const runAction = useCallback(
    (action: ResumeAction) => {
      const plan = buildPlan(action);
      if (plan === null) {
        return;
      }

      if (plan.kind === "print" || plan.kind === "handoff") {
        onLeave(plan);
        exit();
        return;
      }

      setStatus({ text: "…", tone: "info" });
      // Same reason as the refresh path: an unhandled rejection here would kill
      // the process with the terminal still in raw mode.
      void onRun(plan)
        .then(setStatus)
        .catch((error: unknown) => {
          setStatus({ text: String(error), tone: "error" });
        });
    },
    [buildPlan, exit, onLeave, onRun],
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
    <Box flexDirection="column" paddingX={1}>
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

      {mode === "help" ? (
        <Box marginTop={1}>
          <HelpOverlay />
        </Box>
      ) : null}

      <Box marginTop={1}>
        <StatusBar
          row={activeRow}
          status={
            refreshError === null || refreshError === undefined
              ? status
              : { text: refreshError, tone: "error" }
          }
          width={stdout?.columns ?? 100}
        />
      </Box>
    </Box>
  );
};

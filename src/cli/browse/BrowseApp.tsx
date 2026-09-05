import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useCallback, useMemo, useState } from "react";
import type { ConversationListEntry, TopicGroup } from "../../server/core/types.ts";
import { type ActionPlan, planAction } from "../actions/planAction.ts";
import { nextResumeAction, RESUME_ACTION_LABELS, type ResumeAction } from "../config/cliConfig.ts";
import { theme } from "../ui/theme.ts";
import { Board } from "./components/Board.tsx";
import { CLASSIFY_CALLOUT_HEIGHT, ClassifyCallout } from "./components/ClassifyCallout.tsx";
import { CONFIRM_RESORT_HEIGHT, ConfirmResort } from "./components/ConfirmResort.tsx";
import { HelpOverlay } from "./components/HelpOverlay.tsx";
import {
  type PrintedCommand,
  PRINTED_COMMAND_HEIGHT,
  PrintedCommandPanel,
} from "./components/PrintedCommand.tsx";
import { SEARCH_BAR_HEIGHT, SearchBar } from "./components/SearchBar.tsx";
import { StatusBar, type Status } from "./components/StatusBar.tsx";
import { TwoPane } from "./components/TwoPane.tsx";
import { buildColumns } from "./functions/buildColumns.ts";
import { type BrowseMode, type ClassifyScopeKey, resolveKeyAction } from "./functions/keymap.ts";
import {
  advanceWindow,
  boardRowBudget,
  FRAME_PADDING_X,
  framePaddingY,
  OUTER_SPARE_HEIGHT,
  resolveLayout,
} from "./functions/layout.ts";

export type BrowseAppProps = {
  topics: TopicGroup[];
  conversations: ConversationListEntry[];
  total: number;
  /** How many conversations have no topic, so the header can say whether to sort. */
  unclassified?: number | undefined;
  interactiveSources: string[];
  executable: string | undefined;
  defaultAction: ResumeAction;
  /** Remembers a new choice of what Enter does, so it survives the session. */
  onDefaultActionChange: (action: ResumeAction) => void;
  now: Date;
  /**
   * Runs a plan that can be carried out without giving up the screen.
   *
   * `write` is Ink's own writer, not `process.stdout`. Copying puts an OSC 52
   * escape on the wire, and a terminal that neither honours nor strips it prints
   * the payload as text — inside the board, under a renderer that is counting
   * its own rows. Ink erases the frame, writes, and redraws around it.
   */
  onRun: (plan: ActionPlan, write: (chunk: string) => void) => Promise<Status>;
  /**
   * Runs the session, with the terminal already handed over to it.
   *
   * Called inside Ink's terminal suspension: the board stops drawing but stays
   * mounted, so what it returns is a status for a board that still has the
   * user's place in it, not for a new one.
   */
  onResume: (plan: ActionPlan) => Promise<Status>;
  onRefresh: () => void;
  /**
   * Sorts conversations into topics with the configured agent CLI.
   *
   * Returns what the pass amounted to, as a line for the status bar. The board
   * re-reads the logs afterwards either way: a pass that filed anything has
   * changed which column half these conversations belong in.
   */
  onClassify: (scope: ClassifyScopeKey) => Promise<Status>;
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
  /**
   * The size to lay out for, when it is not the size the terminal reports.
   *
   * The board sizes itself to the screen, so "does what it drew fit" is a real
   * question with a real answer — and one worth asking at several sizes, which
   * means asking without a terminal of that size to hand.
   */
  terminal?: { columns: number; rows: number } | undefined;
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
  unclassified,
  interactiveSources,
  executable,
  defaultAction,
  onDefaultActionChange,
  now,
  onRun,
  onResume,
  onRefresh,
  onClassify,
  refreshing,
  refreshError,
  printed,
  onPrint,
  terminal,
}: BrowseAppProps) => {
  const { exit, suspendTerminal } = useApp();
  const { stdout, write } = useStdout();
  const [columnIndex, setColumnIndex] = useState(0);
  const [rowIndex, setRowIndex] = useState(0);
  /**
   * Where the focused column has been scrolled to.
   *
   * Held rather than derived from the cursor, because a window derived from the
   * cursor has to guess — and the only guess available, centring, moves the whole
   * list on every keypress. What is drawn is this anchor put through
   * `advanceWindow`, so a re-read or a search that shortens the column corrects
   * it without anything having to notice.
   */
  const [rowStart, setRowStart] = useState(0);
  const [filter, setFilter] = useState("");
  const [mode, setMode] = useState<BrowseMode>("board");
  const [status, setStatus] = useState<Status>(null);
  const [enterAction, setEnterAction] = useState<ResumeAction>(defaultAction);
  const [classifying, setClassifying] = useState(false);

  const columns = useMemo(
    () => buildColumns({ topics, conversations, filter }),
    [topics, conversations, filter],
  );

  const width = terminal?.columns ?? stdout?.columns ?? 100;
  const height = terminal?.rows ?? stdout?.rows ?? 30;

  /** The width inside the gutter, which is all anything drawn here actually gets. */
  const innerWidth = Math.max(20, width - FRAME_PADDING_X * 2);

  // Everything drawn around the board has to be counted, or the status bar goes
  // off the bottom of a screen the board has already filled. The help overlay is
  // absent from this sum because it replaces the board rather than joining it.
  const claimedRows =
    (printed === null || printed === undefined ? 0 : PRINTED_COMMAND_HEIGHT) +
    // Always drawn, so always spent — which is the point: the board no longer
    // changes height under the user as they open and close the search.
    SEARCH_BAR_HEIGHT +
    (mode === "confirm-resort" ? CONFIRM_RESORT_HEIGHT : 0);

  /*
    Shown once the count is known, whatever the count is: a key that only appears
    on the day it becomes relevant is a key nobody knows exists.

    It is the one thing here that gives way, and only when the alternative is
    nothing to give way — a twenty-row terminal with the resort question open has
    no rows left, and losing a line that advertises a key is better than losing
    the row that says which keys there are.
  */
  const calloutVisible =
    (classifying || unclassified !== undefined) &&
    boardRowBudget({ height, reservedRows: claimedRows + CLASSIFY_CALLOUT_HEIGHT }) > 0;

  const layout = resolveLayout({
    width,
    height,
    topicCount: columns.length,
    reservedRows: claimedRows + (calloutVisible ? CLASSIFY_CALLOUT_HEIGHT : 0),
  });

  const safeColumnIndex = clamp(columnIndex, columns.length - 1);
  const activeColumn = columns[safeColumnIndex];
  const safeRowIndex = clamp(rowIndex, (activeColumn?.rows.length ?? 1) - 1);
  const activeRow = activeColumn?.rows[safeRowIndex];
  const safeRowStart = advanceWindow({
    start: rowStart,
    index: safeRowIndex,
    total: activeColumn?.rows.length ?? 0,
    size: layout.visibleRows,
  });

  const matchCount = columns.reduce((count, column) => count + column.rows.length, 0);

  /** Moves the cursor and takes the window with it, only as far as it has to go. */
  const moveRow = useCallback(
    (target: number) => {
      const next = clamp(target, (activeColumn?.rows.length ?? 1) - 1);
      setRowIndex(next);
      setRowStart(
        advanceWindow({
          start: safeRowStart,
          index: next,
          total: activeColumn?.rows.length ?? 0,
          size: layout.visibleRows,
        }),
      );
    },
    [activeColumn, layout.visibleRows, safeRowStart],
  );

  /** A new query is a new list; keeping a scroll position into the old one is not. */
  const applyFilter = useCallback((value: string) => {
    setFilter(value);
    setRowIndex(0);
    setRowStart(0);
  }, []);

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
      void onRun(plan, write)
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
    [buildPlan, onPrint, onRefresh, onResume, onRun, suspendTerminal, write],
  );

  const classify = useCallback(
    (scope: ClassifyScopeKey) => {
      // One pass at a time. The service serialises them anyway, but a second
      // press would otherwise sit there looking like nothing had happened.
      if (classifying) {
        return;
      }

      setClassifying(true);
      setStatus({
        text:
          scope === "all"
            ? "Sorting every conversation into topics…"
            : "Sorting the conversations with no topic…",
        tone: "info",
      });

      void onClassify(scope)
        .then((result) => {
          setStatus(result);
          // Even a pass that filed nothing has a fresh unsorted count to show,
          // and one that filed something has moved conversations between
          // columns — neither is visible until the board re-reads.
          onRefresh();
        })
        .catch((error: unknown) => {
          setStatus({ text: `Could not sort the conversations: ${String(error)}`, tone: "error" });
        })
        .finally(() => {
          setClassifying(false);
        });
    },
    [classifying, onClassify, onRefresh],
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
        // Each column keeps no scroll position of its own, so arriving in one
        // starts at the top of it rather than part-way down where the last one was.
        setRowStart(0);
        setStatus(null);
        return;
      case "move-row":
        moveRow(safeRowIndex + action.delta);
        setStatus(null);
        return;
      case "move-row-page":
        // A page short of a screenful, so the row that was at the edge is still
        // there to read from after the jump.
        moveRow(safeRowIndex + action.direction * Math.max(1, layout.visibleRows - 1));
        setStatus(null);
        return;
      case "row-edge":
        moveRow(action.edge === "first" ? 0 : (activeColumn?.rows.length ?? 1) - 1);
        return;
      case "open-filter":
        setMode("filter");
        return;
      case "close-overlay":
        // Escape on the board itself has nothing to close, so it drops the query
        // instead — which is the only way back to the whole board now that a
        // filter outlives the bar being open.
        if (mode === "board" && filter !== "") {
          applyFilter("");
        }
        setMode("board");
        return;
      case "toggle-help":
        setMode("help");
        return;
      case "refresh":
        setStatus({ text: "Re-reading the logs…", tone: "info" });
        onRefresh();
        return;
      case "classify":
        setMode("board");
        classify(action.scope);
        return;
      case "ask-resort-all":
        setMode("confirm-resort");
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
    // the bottom of it instead of letting it float under the last column. The
    // padding is a gutter between the board and the edge of the window, and it is
    // paid for in `layout.ts` rather than taken out of the rows the board thinks
    // it has.
    <Box
      flexDirection="column"
      paddingX={FRAME_PADDING_X}
      paddingY={framePaddingY(height)}
      height={Math.max(1, height - OUTER_SPARE_HEIGHT)}
    >
      {/*
        The two ends of the frame, sharing whatever the board did not use.

        The board used to take the slack itself, which glued the header to the top
        row and the keys to the bottom one with a hole between them on any screen
        with room to spare. Split in two, a short board sits in the middle of the
        window instead — and a full one squeezes them both to nothing, which puts
        everything back exactly where a full screen wants it, the keys on the last
        row inside the padding.
      */}
      <Box flexGrow={1} />

      {/*
        One truncating line rather than a row of separate Texts, the name
        included. Separate ones are measured and shrunk independently on a narrow
        terminal, which split "Lantern" down the middle and broke the unsorted
        count in half; inside the truncating line the clipping happens at the end,
        where the least important thing is. The width is what gives Ink something
        to truncate against — without it the line simply runs off the frame.
      */}
      <Box width={innerWidth} marginBottom={1} flexShrink={0}>
        <Text wrap="truncate">
          <Text color={theme.accent} bold>
            Lantern
          </Text>
          <Text dimColor>
            {"  "}
            {columns.length} {columns.length === 1 ? "topic" : "topics"} · {conversations.length}{" "}
            {conversations.length === 1 ? "conversation" : "conversations"}
            {truncated ? ` of ${total}` : ""}
            {refreshing ? " · refreshing" : ""}
          </Text>
          <Text dimColor>{" · enter: "}</Text>
          <Text color={theme.accent}>{RESUME_ACTION_LABELS[enterAction]}</Text>
        </Text>
      </Box>

      {/*
        Stood down while the key list is up, along with the sort row below: the
        list is twenty-odd rows and wants the whole middle of the screen, and
        neither of these is any use behind it.
      */}
      {mode === "help" ? null : (
        <Box flexShrink={0}>
          <SearchBar
            active={mode === "filter"}
            filter={filter}
            matchCount={matchCount}
            width={innerWidth}
            onChange={applyFilter}
            onSubmit={() => {
              setMode("board");
            }}
            onCancel={() => {
              applyFilter("");
              setMode("board");
            }}
          />
        </Box>
      )}

      {/*
        The one thing on screen allowed to give.

        The budget in `layout.ts` is meant to make this moot, and mostly does —
        but it counts rows for panels whose real height depends on how the
        terminal wrapped them, and being wrong by a row there used to mean the
        status bar went off the bottom. Shrinking here instead costs a
        conversation off the end of a column, which is a thing the column already
        says it is doing.
      */}
      <Box flexDirection="column" flexShrink={1} overflowY="hidden">
        {/*
          The key list takes the board's place rather than stacking under it. It is
          twenty-odd rows on its own: shown as well as the board, it pushed
          everything below it off a twenty-four-row terminal, which is the size the
          list is most wanted on.
        */}
        {mode === "help" ? (
          <HelpOverlay />
        ) : columns.length === 0 ? (
          <Text color={theme.muted}>
            {filter === "" ? "No conversations found." : `Nothing matches "${filter}".`}
          </Text>
        ) : layout.mode === "board" ? (
          <Board
            columns={columns}
            layout={layout}
            columnIndex={safeColumnIndex}
            rowIndex={safeRowIndex}
            rowStart={safeRowStart}
            now={now}
          />
        ) : (
          <TwoPane
            columns={columns}
            layout={layout}
            columnIndex={safeColumnIndex}
            rowIndex={safeRowIndex}
            rowStart={safeRowStart}
            now={now}
          />
        )}
      </Box>

      {mode === "confirm-resort" ? (
        <Box marginTop={1} flexShrink={0}>
          <ConfirmResort count={conversations.length} />
        </Box>
      ) : null}

      {/* Its own row, above the key line it used to be lost in. */}
      {calloutVisible && mode !== "help" ? (
        <Box marginTop={1} flexShrink={0}>
          <ClassifyCallout
            unclassified={unclassified ?? 0}
            classifying={classifying}
            width={innerWidth}
          />
        </Box>
      ) : null}

      {printed === null || printed === undefined ? null : (
        // A clear line between the board and the command, so the command does
        // not read as another row of the table.
        <Box marginTop={1} flexShrink={0}>
          <PrintedCommandPanel printed={printed} width={innerWidth} />
        </Box>
      )}

      {/*
        Never shrinks, whatever is above it. The board is windowed to the rows it
        was given, but the key list and the printed command are not — and a status
        bar that gave way to them would be a status bar the user cannot find.
      */}
      <Box marginTop={1} flexShrink={0}>
        <StatusBar
          row={activeRow}
          status={
            refreshError === null || refreshError === undefined
              ? status
              : { text: refreshError, tone: "error" }
          }
          width={innerWidth}
        />
      </Box>

      <Box flexGrow={1} />
    </Box>
  );
};

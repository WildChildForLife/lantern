/** Width below which columns stop being worth drawing side by side. */
const BOARD_MIN_WIDTH = 90;

/** Narrowest a column can get and still show a recognisable title. */
const MIN_COLUMN_WIDTH = 26;

/** Widest a column ever gets: past this, titles float in whitespace. */
const MAX_COLUMN_WIDTH = 40;

/** Width of the topic rail in two-pane mode. */
const RAIL_WIDTH = 24;

/** Header, filter line, status bar and the frame around them. */
const CHROME_HEIGHT = 8;

export type Layout = {
  mode: "board" | "two-pane";
  /** Width of one topic column, or of the conversation pane in two-pane mode. */
  columnWidth: number;
  railWidth: number;
  /** How many topic columns fit at once. Zero when there are no topics. */
  visibleColumns: number;
  /** How many conversations fit in a column before it has to scroll. */
  visibleRows: number;
};

/**
 * Decides how the board fits into the terminal it was given.
 *
 * Pure so the awkward sizes — a 70-column window, a 4-row split pane, no topics
 * at all — are settled in tests rather than by resizing a terminal by hand.
 */
export const resolveLayout = ({
  width,
  height,
  topicCount,
}: {
  width: number;
  height: number;
  topicCount: number;
}): Layout => {
  const visibleRows = Math.max(1, height - CHROME_HEIGHT);

  if (width < BOARD_MIN_WIDTH) {
    return {
      mode: "two-pane",
      columnWidth: Math.max(MIN_COLUMN_WIDTH, width - RAIL_WIDTH - 3),
      railWidth: RAIL_WIDTH,
      visibleColumns: Math.min(topicCount, 1),
      visibleRows,
    };
  }

  const fitting = Math.max(1, Math.floor(width / (MIN_COLUMN_WIDTH + 1)));
  const visibleColumns = Math.min(topicCount, fitting);
  const columnWidth =
    visibleColumns === 0
      ? MIN_COLUMN_WIDTH
      : Math.min(MAX_COLUMN_WIDTH, Math.floor(width / visibleColumns) - 1);

  return {
    mode: "board",
    columnWidth: Math.max(MIN_COLUMN_WIDTH, columnWidth),
    railWidth: RAIL_WIDTH,
    visibleColumns,
    visibleRows,
  };
};

/**
 * The slice of a list to draw so that the cursor stays on screen.
 *
 * Scrolls only when the cursor would leave the window, which keeps the board
 * still while the user moves around inside what they can already see.
 */
export const resolveWindow = ({
  index,
  total,
  size,
}: {
  index: number;
  total: number;
  size: number;
}): { start: number; end: number } => {
  if (size <= 0 || total <= 0) {
    return { start: 0, end: 0 };
  }

  if (total <= size) {
    return { start: 0, end: total };
  }

  const half = Math.floor(size / 2);
  const start = Math.min(Math.max(0, index - half), total - size);

  return { start, end: start + size };
};

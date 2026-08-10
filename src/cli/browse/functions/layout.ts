/** Width below which columns stop being worth drawing side by side. */
const BOARD_MIN_WIDTH = 90;

/** Narrowest a column can get and still show a recognisable title. */
const MIN_COLUMN_WIDTH = 26;

/** Widest a column ever gets: past this, titles float in whitespace. */
const MAX_COLUMN_WIDTH = 40;

/** Width of the topic rail in two-pane mode, where the terminal allows it. */
const RAIL_WIDTH = 24;

/** Narrowest the rail is allowed to get before it stops being a label at all. */
const TOPIC_RAIL_MIN_WIDTH = 10;

/** The rail's right margin, plus the row's own padding. */
const TWO_PANE_GAP = 3;

/**
 * Rows the board spends on something other than conversations.
 *
 * Spelled out per piece rather than as one number, because it was one number and
 * it was wrong: the status bar is two lines plus its margin, and a column spends
 * two rows on its own label and divider before a single conversation is drawn,
 * neither of which the old figure accounted for. Every row here is a row that
 * would otherwise push the status bar off the bottom of the screen.
 */
const HEADER_HEIGHT = 2;
const STATUS_BAR_HEIGHT = 3;
const COLUMN_HEADING_HEIGHT = 2;
/** `↑ N more` and `↓ N more`, both drawn once a column is long enough to scroll. */
const SCROLL_INDICATOR_HEIGHT = 2;
/** The root box is kept a row short of the terminal, so nothing scrolls it. */
const OUTER_SPARE_HEIGHT = 1;

const CHROME_HEIGHT =
  HEADER_HEIGHT +
  STATUS_BAR_HEIGHT +
  COLUMN_HEADING_HEIGHT +
  SCROLL_INDICATOR_HEIGHT +
  OUTER_SPARE_HEIGHT;

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
  reservedRows = 0,
}: {
  width: number;
  height: number;
  topicCount: number;
  /**
   * Rows something else has already claimed: the filter line, the sort row, the
   * printed-command panel, the confirmation. Counted here rather than left to
   * overflow, because the board fills the screen — anything drawn under it pushes
   * the status bar off the bottom instead of simply landing below the fold.
   */
  reservedRows?: number | undefined;
}): Layout => {
  const visibleRows = Math.max(1, height - CHROME_HEIGHT - Math.max(0, reservedRows));

  if (width < BOARD_MIN_WIDTH) {
    // The rail gives way on a very narrow terminal rather than holding its width
    // and pushing the conversations off the right-hand edge. A floor of 26 columns
    // for the pane plus a fixed 24-column rail needs 52 columns to draw, so below
    // that the old sums overflowed a split pane or a phone SSH client silently.
    const railWidth = Math.min(RAIL_WIDTH, Math.max(TOPIC_RAIL_MIN_WIDTH, Math.floor(width / 3)));

    return {
      mode: "two-pane",
      columnWidth: Math.max(1, width - railWidth - TWO_PANE_GAP),
      railWidth,
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

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
export const OUTER_SPARE_HEIGHT = 1;

/**
 * The gutter the frame keeps between itself and the terminal.
 *
 * Exported rather than written into the root box, because padding is not
 * decoration here: every padded row is a conversation the board cannot draw and
 * every padded column is width the topics do not get, and both sums are made
 * below. A literal in the component and a literal here is how they drift.
 */
export const FRAME_PADDING_X = 2;

/** Shortest terminal with rows to spare for a gutter above and below. */
const PADDED_MIN_HEIGHT = 24;

/**
 * The gutter's height, which a short terminal does not get.
 *
 * Twenty rows is a split pane or a phone, and there the two rows are the
 * difference between the board showing the question it just asked and the board
 * pushing its own status bar off the screen. Breathing room is worth having
 * where there is room to breathe.
 */
export const framePaddingY = (height: number): number => (height >= PADDED_MIN_HEIGHT ? 1 : 0);

const CHROME_HEIGHT =
  HEADER_HEIGHT +
  STATUS_BAR_HEIGHT +
  COLUMN_HEADING_HEIGHT +
  SCROLL_INDICATOR_HEIGHT +
  OUTER_SPARE_HEIGHT;

/**
 * Rows left for conversations once everything else has taken its share.
 *
 * Returns the true figure, which can be nought or less — `resolveLayout` draws a
 * row regardless, because a board of no rows is not a board, but a caller
 * deciding whether it can afford to show something needs to know it is already
 * over budget rather than being told the floor.
 */
export const boardRowBudget = ({
  height,
  reservedRows = 0,
}: {
  height: number;
  reservedRows?: number | undefined;
}): number => height - CHROME_HEIGHT - framePaddingY(height) * 2 - Math.max(0, reservedRows);

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
  const visibleRows = Math.max(1, boardRowBudget({ height, reservedRows }));

  // Everything below measures the space inside the frame, not the terminal. The
  // two were the same until the frame gained padding, and a column sized to the
  // terminal is a column the padding clips.
  const inner = Math.max(1, width - FRAME_PADDING_X * 2);

  if (inner < BOARD_MIN_WIDTH) {
    // The rail gives way on a very narrow terminal rather than holding its width
    // and pushing the conversations off the right-hand edge. A floor of 26 columns
    // for the pane plus a fixed 24-column rail needs 52 columns to draw, so below
    // that the old sums overflowed a split pane or a phone SSH client silently.
    const railWidth = Math.min(RAIL_WIDTH, Math.max(TOPIC_RAIL_MIN_WIDTH, Math.floor(inner / 3)));

    return {
      mode: "two-pane",
      columnWidth: Math.max(1, inner - railWidth - TWO_PANE_GAP),
      railWidth,
      visibleColumns: Math.min(topicCount, 1),
      visibleRows,
    };
  }

  const fitting = Math.max(1, Math.floor(inner / (MIN_COLUMN_WIDTH + 1)));
  const visibleColumns = Math.min(topicCount, fitting);
  const columnWidth =
    visibleColumns === 0
      ? MIN_COLUMN_WIDTH
      : Math.min(MAX_COLUMN_WIDTH, Math.floor(inner / visibleColumns) - 1);

  return {
    mode: "board",
    columnWidth: Math.max(MIN_COLUMN_WIDTH, columnWidth),
    railWidth: RAIL_WIDTH,
    visibleColumns,
    visibleRows,
  };
};

/**
 * The slice of a list to draw around a cursor, with no memory of where the
 * window was last time.
 *
 * Centres the cursor whenever the list overflows, so it is right for a list
 * being drawn cold — an unfocused column, or the topic rail. For the column the
 * user is actually moving through, use `advanceWindow`: centring there moves the
 * whole list under a stationary cursor on every keypress.
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

/** Rows kept between the cursor and the edge of the window, where there is room. */
const SCROLLOFF = 1;

/**
 * Where the window sits after the cursor has moved, given where it sat before.
 *
 * The list stays still and the cursor moves through it; the list only gives once
 * the cursor reaches the margin at either end. That is the difference between
 * scrolling a list and having a list scroll past you, and it is why this takes a
 * previous `start` rather than deriving one from the cursor alone.
 *
 * Also the place a stale anchor is corrected: the columns are rebuilt on every
 * re-read and every keystroke of the search, so the list under the window is
 * routinely a different length than it was when the window last moved.
 */
export const advanceWindow = ({
  start,
  index,
  total,
  size,
}: {
  start: number;
  index: number;
  total: number;
  size: number;
}): number => {
  if (size <= 0 || total <= size) {
    return 0;
  }

  const last = total - size;
  // A window of one or two rows has no room for a margin: keeping one would put
  // the cursor outside the window it is supposed to be inside.
  const scrolloff = size < SCROLLOFF * 2 + 1 ? 0 : SCROLLOFF;
  const anchored = Math.min(Math.max(0, start), last);

  const moved =
    index < anchored + scrolloff
      ? index - scrolloff
      : index > anchored + size - 1 - scrolloff
        ? index - size + 1 + scrolloff
        : anchored;

  return Math.min(Math.max(0, moved), last);
};

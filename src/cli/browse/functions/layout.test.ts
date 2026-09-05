import { describe, expect, it } from "vitest";
import {
  advanceWindow,
  boardRowBudget,
  FRAME_PADDING_X,
  framePaddingY,
  type Layout,
  resolveLayout,
  resolveWindow,
} from "./layout.ts";

/**
 * Narrows a layout to the mode the assertion is about.
 *
 * The two modes carry different fields, so reading one is also a claim about
 * which mode came back — these say that out loud, and fail on the claim rather
 * than on a confusing `undefined` further down.
 */
const asBoard = (layout: Layout): Extract<Layout, { mode: "board" }> => {
  if (layout.mode !== "board") {
    throw new Error(`expected the board layout, got ${layout.mode}`);
  }

  return layout;
};

const asTwoPane = (layout: Layout): Extract<Layout, { mode: "two-pane" }> => {
  if (layout.mode !== "two-pane") {
    throw new Error(`expected the two-pane layout, got ${layout.mode}`);
  }

  return layout;
};

/**
 * The window's own memory, which is what makes scrolling read as scrolling.
 *
 * `resolveWindow` centres the cursor, so every keypress moved the whole list
 * under a stationary cursor. This keeps the list still and moves the cursor
 * through it, until the cursor reaches an edge and the list has to give.
 */
describe("advanceWindow", () => {
  it("stays at the top while everything fits", () => {
    expect(advanceWindow({ start: 0, index: 3, total: 5, size: 10 })).toBe(0);
  });

  it("forgets a stale anchor once the list is short enough to fit", () => {
    expect(advanceWindow({ start: 40, index: 1, total: 5, size: 10 })).toBe(0);
  });

  it("leaves the window alone while the cursor moves about inside it", () => {
    expect(advanceWindow({ start: 10, index: 15, total: 100, size: 10 })).toBe(10);
  });

  it("scrolls by one when the cursor walks off the bottom", () => {
    // Window 10..19, scrolloff 1, so row 18 is the last one drawn without moving.
    expect(advanceWindow({ start: 10, index: 18, total: 100, size: 10 })).toBe(10);
    expect(advanceWindow({ start: 10, index: 19, total: 100, size: 10 })).toBe(11);
  });

  it("scrolls by one when the cursor walks off the top", () => {
    expect(advanceWindow({ start: 10, index: 11, total: 100, size: 10 })).toBe(10);
    expect(advanceWindow({ start: 10, index: 10, total: 100, size: 10 })).toBe(9);
  });

  it("jumps far enough to catch a cursor that moved a whole page", () => {
    expect(advanceWindow({ start: 0, index: 50, total: 100, size: 10 })).toBe(42);
  });

  it("stops at the top rather than scrolling past it", () => {
    expect(advanceWindow({ start: 4, index: 0, total: 100, size: 10 })).toBe(0);
  });

  it("stops at the bottom rather than scrolling past it", () => {
    expect(advanceWindow({ start: 95, index: 99, total: 100, size: 10 })).toBe(90);
  });

  /** A shorter column after a re-read must not leave the window off its end. */
  it("pulls a stale anchor back inside a list that shrank", () => {
    expect(advanceWindow({ start: 80, index: 0, total: 20, size: 10 })).toBe(0);
    expect(advanceWindow({ start: 80, index: 19, total: 20, size: 10 })).toBe(10);
  });

  /** With one row on screen there is no margin to keep, only the cursor. */
  it("drops the margin when the window is too small to hold one", () => {
    expect(advanceWindow({ start: 5, index: 9, total: 100, size: 1 })).toBe(9);
    expect(advanceWindow({ start: 5, index: 6, total: 100, size: 2 })).toBe(5);
  });

  it("draws nothing for an empty list", () => {
    expect(advanceWindow({ start: 3, index: 0, total: 0, size: 10 })).toBe(0);
  });
});

describe("resolveWindow", () => {
  it("shows everything when it all fits", () => {
    expect(resolveWindow({ index: 0, total: 5, size: 10 })).toStrictEqual({ start: 0, end: 5 });
  });

  it("keeps the cursor on screen once the list is longer than the window", () => {
    const { start, end } = resolveWindow({ index: 40, total: 100, size: 10 });

    expect(start).toBeLessThanOrEqual(40);
    expect(end).toBeGreaterThan(40);
    expect(end - start).toBe(10);
  });

  it("stops at the top rather than scrolling past it", () => {
    expect(resolveWindow({ index: 0, total: 100, size: 10 }).start).toBe(0);
  });

  it("stops at the bottom rather than scrolling past it", () => {
    expect(resolveWindow({ index: 99, total: 100, size: 10 })).toStrictEqual({
      start: 90,
      end: 100,
    });
  });

  it("draws nothing for an empty list", () => {
    expect(resolveWindow({ index: 0, total: 0, size: 10 })).toStrictEqual({ start: 0, end: 0 });
  });
});

describe("resolveLayout", () => {
  it("shows the board when there is room for more than one column", () => {
    const layout = asBoard(resolveLayout({ width: 160, height: 40, topicCount: 8 }));

    expect(layout.visibleColumns).toBeGreaterThan(1);
  });

  /** One column at a time is not a board, it is a worse list. */
  it("falls back to two panes on a narrow terminal", () => {
    expect(resolveLayout({ width: 70, height: 30, topicCount: 8 }).mode).toBe("two-pane");
  });

  it("never claims more columns than there are topics", () => {
    expect(asBoard(resolveLayout({ width: 400, height: 40, topicCount: 2 })).visibleColumns).toBe(
      2,
    );
  });

  it("leaves at least one row visible on a very short terminal", () => {
    expect(resolveLayout({ width: 160, height: 4, topicCount: 3 }).visibleRows).toBeGreaterThan(0);
  });

  it("grows the visible rows with the terminal height", () => {
    const short = resolveLayout({ width: 160, height: 20, topicCount: 3 });
    const tall = resolveLayout({ width: 160, height: 50, topicCount: 3 });

    expect(tall.visibleRows).toBeGreaterThan(short.visibleRows);
  });

  it("keeps columns wide enough for a title to survive truncation", () => {
    expect(resolveLayout({ width: 160, height: 40, topicCount: 20 }).columnWidth).toBeGreaterThan(
      20,
    );
  });

  /** Nothing to partition: the board has no columns to draw. */
  it("copes with no topics at all", () => {
    const layout = asBoard(resolveLayout({ width: 160, height: 40, topicCount: 0 }));

    expect(layout.visibleColumns).toBe(0);
  });

  /**
   * The board fills the screen, so a panel under it would push the status bar
   * off the bottom rather than simply landing below the fold.
   */
  it("gives back the rows something else has claimed", () => {
    const alone = resolveLayout({ width: 160, height: 40, topicCount: 3 });
    const sharing = resolveLayout({ width: 160, height: 40, topicCount: 3, reservedRows: 6 });

    expect(alone.visibleRows - sharing.visibleRows).toBe(6);
  });

  it("still leaves a row visible when the reservation is larger than the screen", () => {
    expect(
      resolveLayout({ width: 160, height: 10, topicCount: 3, reservedRows: 40 }).visibleRows,
    ).toBe(1);
  });

  /**
   * The floor is right for drawing and wrong for deciding: a caller weighing up
   * whether it can afford another panel has to be told it is already over.
   */
  it("reports the true budget, below nothing included", () => {
    expect(boardRowBudget({ height: 10, reservedRows: 40 })).toBeLessThan(0);
    expect(boardRowBudget({ height: 40, reservedRows: 6 })).toBe(
      resolveLayout({ width: 160, height: 40, topicCount: 3, reservedRows: 6 }).visibleRows,
    );
  });

  /**
   * The rows the board does not draw conversations into: two for the header, three
   * for the status bar, two for a column's label and divider, two for the scroll
   * indicators, one kept spare so the frame never scrolls the terminal, and one
   * top and bottom for the frame's own padding. This was a single number that came
   * to nine when the truth was eleven, and the status bar went off the bottom of
   * every scrolling column.
   */
  it("leaves room for everything drawn around the conversations", () => {
    expect(resolveLayout({ width: 160, height: 40, topicCount: 3 }).visibleRows).toBe(28);
  });

  /** Twenty rows is a split pane: the gutter is the first thing it cannot afford. */
  it("gives a short terminal back the rows the gutter would have taken", () => {
    expect(framePaddingY(40)).toBe(1);
    expect(framePaddingY(20)).toBe(0);
    expect(resolveLayout({ width: 160, height: 20, topicCount: 3 }).visibleRows).toBe(10);
  });

  /**
   * The frame is padded, so the columns have fewer columns to share than the
   * terminal has. Sizing them from the raw width overflowed the frame by exactly
   * the padding, and the rightmost column lost its last characters to it.
   */
  it("sizes the columns to the padded frame rather than the whole terminal", () => {
    const layout = asBoard(resolveLayout({ width: 160, height: 40, topicCount: 8 }));
    const drawn = layout.visibleColumns * (layout.columnWidth + 1);

    expect(drawn).toBeLessThanOrEqual(160 - FRAME_PADDING_X * 2);
  });

  it("fits the two-pane layout inside the padding too", () => {
    const layout = asTwoPane(resolveLayout({ width: 70, height: 30, topicCount: 8 }));

    expect(layout.railWidth + 2 + layout.columnWidth).toBeLessThanOrEqual(70 - FRAME_PADDING_X * 2);
  });

  /** Rail plus its margin plus the pane has to fit the terminal it was given. */
  it.each([[40], [45], [60], [70], [89]])("fits the two-pane layout into %i columns", (width) => {
    const layout = asTwoPane(resolveLayout({ width, height: 30, topicCount: 8 }));

    expect(layout.railWidth + 2 + layout.columnWidth).toBeLessThanOrEqual(width);
  });

  it("keeps the rail wide enough to read a topic name at all", () => {
    expect(
      asTwoPane(resolveLayout({ width: 45, height: 30, topicCount: 8 })).railWidth,
    ).toBeGreaterThan(9);
  });
});

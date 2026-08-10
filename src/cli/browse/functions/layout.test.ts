import { describe, expect, it } from "vitest";
import { resolveLayout, resolveWindow } from "./layout.ts";

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
    const layout = resolveLayout({ width: 160, height: 40, topicCount: 8 });

    expect(layout.mode).toBe("board");
    expect(layout.visibleColumns).toBeGreaterThan(1);
  });

  /** One column at a time is not a board, it is a worse list. */
  it("falls back to two panes on a narrow terminal", () => {
    expect(resolveLayout({ width: 70, height: 30, topicCount: 8 }).mode).toBe("two-pane");
  });

  it("never claims more columns than there are topics", () => {
    expect(resolveLayout({ width: 400, height: 40, topicCount: 2 }).visibleColumns).toBe(2);
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
    const layout = resolveLayout({ width: 160, height: 40, topicCount: 0 });

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
});

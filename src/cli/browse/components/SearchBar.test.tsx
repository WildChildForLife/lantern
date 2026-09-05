import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { stripAnsiColors } from "../../../server/core/git/functions/text.ts";
import { SEARCH_BAR_HEIGHT, SearchBar } from "./SearchBar.tsx";

const plain = (frame: string | undefined): string => stripAnsiColors(frame ?? "");

const draw = (overrides?: Partial<Parameters<typeof SearchBar>[0]>) =>
  render(
    <SearchBar
      active={false}
      filter=""
      matchCount={0}
      width={100}
      onChange={vi.fn()}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
      {...overrides}
    />,
  );

describe("SearchBar", () => {
  /** A feature nobody can see is a feature nobody uses. */
  it("names itself before anything has been typed", () => {
    expect(plain(draw().lastFrame())).toContain("⌕ SEARCH");
  });

  it("says which key opens it while it is idle", () => {
    expect(plain(draw().lastFrame())).toContain("press / to search");
  });

  it("shows what is being typed into it", () => {
    expect(plain(draw({ active: true, filter: "refund" }).lastFrame())).toContain("refund");
  });

  /**
   * The whole reason the bar is always drawn: the query used to vanish on Enter
   * and leave the board filtered by something invisible.
   */
  it("keeps the query on screen once the board has the keyboard back", () => {
    const frame = plain(draw({ active: false, filter: "refund", matchCount: 3 }).lastFrame());

    expect(frame).toContain("refund");
    expect(frame).toContain("3 matches");
  });

  it("no longer advertises the key once there is a query to show", () => {
    expect(plain(draw({ filter: "refund" }).lastFrame())).not.toContain("press /");
  });

  it("says how to change the query and how to drop it", () => {
    expect(plain(draw({ filter: "refund", matchCount: 1 }).lastFrame())).toContain(
      "1 match · / edit · esc clear",
    );
  });

  it("says how to keep the query while it is being typed", () => {
    expect(plain(draw({ active: true, filter: "ref", matchCount: 2 }).lastFrame())).toContain(
      "2 matches · enter keep · esc clear",
    );
  });

  it("says plainly when a query matches nothing", () => {
    expect(plain(draw({ active: true, filter: "zzz" }).lastFrame())).toContain("no matches");
  });

  /**
   * The board's rows are budgeted to the terminal, so a bar that wrapped onto a
   * second line would push the status bar off the bottom of the screen.
   */
  it.each([[false], [true]])("stays inside its budget while active is %s", (active) => {
    for (const width of [30, 40, 63, 64, 100, 200]) {
      const frame = plain(
        draw({
          active,
          filter: "a query long enough to crowd even a wide terminal, and then some more",
          matchCount: 12,
          width,
        }).lastFrame(),
      );
      const lines = frame.replace(/\n+$/, "").split("\n");

      expect(lines.length, `wrapped at ${width} columns`).toBeLessThan(SEARCH_BAR_HEIGHT);
      expect(lines[0]?.length, `overflowed ${width} columns`).toBeLessThanOrEqual(width);
    }
  });

  it("gives up the hint rather than the query on a narrow terminal", () => {
    const frame = plain(draw({ filter: "refund", matchCount: 3, width: 40 }).lastFrame());

    expect(frame).toContain("refund");
    expect(frame).not.toContain("esc clear");
  });
});

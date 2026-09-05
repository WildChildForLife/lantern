import { render } from "ink-testing-library";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ConversationListEntry, TopicGroup } from "../../server/core/types.ts";
import { BrowseApp, type BrowseAppProps } from "./BrowseApp.tsx";
import { framePaddingY, OUTER_SPARE_HEIGHT } from "./functions/layout.ts";

const ESC = String.fromCodePoint(0x1b);

const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 20));

const topics: TopicGroup[] = Array.from({ length: 4 }, (_unused, index) => ({
  id: `topic-${index}`,
  label: `Topic ${index}`,
  icon: "plug",
  count: 40,
}));

/** Long enough that every column scrolls, which is what draws both indicators. */
const conversations: ConversationListEntry[] = topics.flatMap((topic) =>
  Array.from({ length: 40 }, (_unused, index) => ({
    sessionId: `${topic.id}-${index}`,
    projectId: "project",
    source: "claude-code",
    projectName: "lantern",
    projectPath: "/home/dev/lantern",
    title: `Conversation ${index}`,
    firstUserMessage: null,
    messageCount: 4,
    lastModifiedAt: "2026-08-06T00:00:00.000Z",
    modelName: "sonnet",
    totalCostUsd: 0.42,
    costConfidence: "estimated",
    topic: { id: topic.id, label: topic.label, icon: topic.icon },
  })),
);

const plain = (frame: string | undefined): string =>
  (frame ?? "").replaceAll(new RegExp(`${ESC}\\[[0-9;?]*[a-zA-Z]`, "g"), "");

const heightOf = (frame: string | undefined): number =>
  plain(frame).replace(/\n$/, "").split("\n").length;

/** The frame with its blank gutter rows taken off either end. */
const drawnLines = (frame: string | undefined): string[] => {
  const lines = plain(frame).replace(/\n$/, "").split("\n");
  const first = lines.findIndex((line) => line.trim() !== "");
  const last = lines.findLastIndex((line) => line.trim() !== "");

  return first === -1 ? [] : lines.slice(first, last + 1);
};

const draw = async (
  rows: number,
  overrides?: Partial<BrowseAppProps>,
  keys?: string,
  columns = 100,
) => {
  const { lastFrame, stdin } = render(
    <BrowseApp
      topics={topics}
      conversations={conversations}
      total={conversations.length}
      unclassified={7}
      interactiveSources={["claude-code"]}
      executable={undefined}
      defaultAction="resume-here"
      onDefaultActionChange={vi.fn()}
      now={new Date("2026-08-07T00:00:00.000Z")}
      onRun={vi.fn()}
      onResume={vi.fn()}
      onRefresh={vi.fn()}
      onClassify={vi.fn()}
      refreshing={false}
      terminal={{ columns, rows }}
      {...overrides}
    />,
  );

  await nextFrame();

  if (keys !== undefined) {
    await act(async () => {
      stdin.write(keys);
      await nextFrame();
    });
  }

  return lastFrame();
};

/**
 * The board is sized to the terminal, and its root box is a fixed height, so
 * content that does not fit is not scrolled — it is cut off the bottom, and the
 * bottom is where the status bar lives. `layout.test.ts` checks the arithmetic;
 * this checks it against what is actually drawn, which is where the two came
 * apart: the status bar is three rows, a column spends two on its own heading
 * before a single conversation, and neither was in the budget.
 *
 * Every case here is asserted on the last line of the frame rather than on the
 * frame's height, because the height is always right — a row too many simply
 * pushes the hint line out of existence.
 */
describe("the board keeps its status bar on screen", () => {
  const heights = [20, 24, 30, 50];

  /**
   * Nothing the board meant to draw was cut off.
   *
   * The status bar is checked from the bottom, and the column's own `↓ N more`
   * marker from anywhere: the marker is drawn after the conversations, so an
   * over-budget layout loses it first — the frame stays exactly as tall as the
   * terminal and a row of the board silently ceases to exist.
   */
  const expectNothingClipped = (frame: string | undefined, tail = "more") => {
    // The frame ends in the bottom gutter on a terminal tall enough to have one,
    // so the status bar is the last thing drawn rather than the last line.
    const lines = drawnLines(frame);

    expect(lines.at(-1)).toContain("←→ topics");
    expect(lines.at(-2)).toContain("/home/dev/lantern");
    expect(plain(frame)).toContain(tail);
  };

  it.each(heights)("with scrolling columns, on %i rows", async (rows) => {
    expectNothingClipped(await draw(rows));
  });

  it.each(heights)("with the printed command shown, on %i rows", async (rows) => {
    expectNothingClipped(
      await draw(rows, {
        printed: { cwd: "/home/dev/lantern", text: `claude --resume "s-refund"`, token: 1 },
      }),
    );
  });

  it.each(heights)("with the key list open, on %i rows", async (rows) => {
    expectNothingClipped(await draw(rows, undefined, "?"), "any key to go back");
  });

  it.each(heights)("with the filter open, on %i rows", async (rows) => {
    expectNothingClipped(await draw(rows, undefined, "/"));
  });

  it.each(heights)("with the resort question open, on %i rows", async (rows) => {
    expectNothingClipped(await draw(rows, undefined, "T"));
  });

  it.each(heights)("never draws more rows than the terminal has, on %i rows", async (rows) => {
    expect(heightOf(await draw(rows))).toBeLessThanOrEqual(rows);
  });

  /** The board still has to fill the screen it was given, not a corner of it. */
  it("uses the height it was given rather than a fixed guess", async () => {
    expect(heightOf(await draw(50))).toBeGreaterThan(heightOf(await draw(24)));
  });
});

/**
 * The same question asked sideways.
 *
 * Rows are budgeted per panel, and a panel's row count assumes it fits on one
 * line — so a narrow terminal that wrapped one of them spent a row nobody had
 * counted, and the status bar went off the bottom. Every panel here has to hold
 * its declared height at every width, and nothing may overflow the frame.
 */
describe("the board keeps its status bar on screen on a narrow terminal", () => {
  const widths = [40, 50, 70, 89, 90, 120];

  const expectFits = (frame: string | undefined, columns: number) => {
    const lines = drawnLines(frame);

    expect(lines.at(-1)).toContain("←→ topics");
    for (const line of plain(frame).split("\n")) {
      expect(line.length, `overflowed ${columns} columns: ${line}`).toBeLessThanOrEqual(columns);
    }
  };

  it.each(widths)("with the board as it comes, at %i columns", async (columns) => {
    expectFits(await draw(24, undefined, undefined, columns), columns);
  });

  it.each(widths)("with the search open, at %i columns", async (columns) => {
    expectFits(await draw(24, undefined, "/", columns), columns);
  });

  it.each(widths)("with the printed command shown, at %i columns", async (columns) => {
    expectFits(
      await draw(
        30,
        { printed: { cwd: "/home/dev/lantern", text: `claude --resume "s-refund"`, token: 1 } },
        undefined,
        columns,
      ),
      columns,
    );
  });

  /** The name of the thing is the last part of the header worth losing. */
  it.each(widths)("keeps its own name in the header, at %i columns", async (columns) => {
    expect(plain(await draw(24, undefined, undefined, columns))).toContain("Lantern");
  });
});

/**
 * Blank rows above the first drawn line and below the last, in that order.
 *
 * The rows below are counted from the terminal rather than from the frame: Ink
 * does not emit a run of blanks at the end of one, so a bottom gutter that is
 * really there on screen is simply absent from the string.
 */
const gutters = (frame: string | undefined, rows: number): [number, number] => {
  const lines = plain(frame).replace(/\n$/, "").split("\n");
  const first = lines.findIndex((line) => line.trim() !== "");
  const last = lines.findLastIndex((line) => line.trim() !== "");

  return first === -1 ? [rows, rows] : [first, rows - OUTER_SPARE_HEIGHT - 1 - last];
};

/**
 * Where the frame sits in the window it was given.
 *
 * The board used to take all the slack itself, which pinned the header to the
 * top row and the keys to the bottom one with a hole between them. It is shared
 * between the two ends now, so a board with little in it sits in the middle of
 * the window and a full one still fills it.
 */
describe("the board sits in the middle of the window it was given", () => {
  const oneTopic = topics.slice(0, 1);
  const sparse = conversations.filter((entry) => entry.topic.id === topics[0]?.id).slice(0, 3);

  it("shares the slack evenly when there is little to draw", async () => {
    const [above, below] = gutters(
      await draw(50, { topics: oneTopic, conversations: sparse, total: sparse.length }),
      50,
    );

    expect(above).toBeGreaterThan(4);
    expect(Math.abs(above - below)).toBeLessThanOrEqual(1);
  });

  /**
   * The other half of it: as a column fills up the keys walk down towards the
   * bottom of the window, and stop at the gutter rather than going through it.
   */
  it.each([20, 24, 30, 50])("stops the keys at the gutter, on %i rows", async (rows) => {
    const [above, below] = gutters(await draw(rows), rows);

    expect(below).toBe(framePaddingY(rows));
    // A row over is the scroll marker the budget reserves at the top of a column
    // that has not been scrolled yet. A void is what this is here to rule out.
    expect(above).toBeLessThanOrEqual(framePaddingY(rows) + 1);
  });

  it("leaves the keys where they were once the column is scrolled", async () => {
    expect(gutters(await draw(30, undefined, "[6~"), 30)[1]).toBe(framePaddingY(30));
  });
});

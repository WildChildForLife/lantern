import { render } from "ink-testing-library";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ConversationListEntry, TopicGroup } from "../../server/core/types.ts";
import { BrowseApp, type BrowseAppProps } from "./BrowseApp.tsx";

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

const draw = async (rows: number, overrides?: Partial<BrowseAppProps>, keys?: string) => {
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
      terminal={{ columns: 100, rows }}
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
    const lines = plain(frame).replace(/\n$/, "").split("\n");

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

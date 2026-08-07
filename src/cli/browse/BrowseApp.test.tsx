import { render } from "ink-testing-library";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ConversationListEntry, TopicGroup } from "../../server/core/types.ts";
import { BrowseApp, type BrowseAppProps } from "./BrowseApp.tsx";

const ESC = String.fromCodePoint(0x1b);
const ARROW_RIGHT = `${ESC}[C`;
const ARROW_DOWN = `${ESC}[B`;
const ENTER = "\r";

const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * Colour codes land between adjacent `<Text>` nodes, so a phrase split across
 * two of them is not contiguous in the raw frame.
 */
const plain = (frame: string | undefined): string =>
  (frame ?? "").replaceAll(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");

/**
 * Ink drives React itself, so every keypress lands outside act(). Wrapping the
 * writes keeps the suite from printing a "not wrapped in act" warning per
 * assertion, which the shared setup file already goes to some length to avoid.
 */
const press = async (stdin: { write: (input: string) => void }, input: string) => {
  await act(async () => {
    stdin.write(input);
    await nextFrame();
  });
};

const topics: TopicGroup[] = [
  { id: "api", label: "Orders API", icon: "plug", count: 2 },
  { id: "net", label: "Home Network", icon: "wifi", count: 1 },
];

const conversation = (
  sessionId: string,
  topicId: string,
  title: string,
  source = "claude-code",
): ConversationListEntry => ({
  sessionId,
  projectId: "project",
  source,
  projectName: "lantern",
  projectPath: "/home/dev/lantern",
  title,
  firstUserMessage: null,
  messageCount: 4,
  lastModifiedAt: "2026-08-06T00:00:00.000Z",
  modelName: "sonnet",
  totalCostUsd: 0.42,
  costConfidence: "estimated",
  topic: { id: topicId, label: "", icon: "plug" },
});

const conversations = [
  conversation("s-refund", "api", "Add refunds"),
  conversation("s-checkout", "api", "Fix checkout"),
  conversation("s-router", "net", "Router DHCP", "codex"),
];

const setup = (overrides?: Partial<BrowseAppProps>) => {
  const onRun = vi.fn().mockResolvedValue({ text: "done", tone: "ok" });
  const onLeave = vi.fn();
  const onRefresh = vi.fn();
  const onDefaultActionChange = vi.fn();

  const result = render(
    <BrowseApp
      topics={topics}
      conversations={conversations}
      total={conversations.length}
      interactiveSources={["claude-code"]}
      executable={undefined}
      defaultAction="resume-here"
      onDefaultActionChange={onDefaultActionChange}
      terminalCommand={undefined}
      emulator="kitty"
      platform="linux"
      now={new Date("2026-08-07T00:00:00.000Z")}
      onRun={onRun}
      onLeave={onLeave}
      onRefresh={onRefresh}
      refreshing={false}
      {...overrides}
    />,
  );

  return { ...result, onRun, onLeave, onRefresh, onDefaultActionChange };
};

describe("BrowseApp", () => {
  it("draws a column per topic and the conversations in it", async () => {
    const { lastFrame } = setup();
    await nextFrame();

    expect(lastFrame()).toContain("Orders API");
    expect(lastFrame()).toContain("Home Network");
    expect(lastFrame()).toContain("Add refunds");
  });

  it("shows the detail of the selected conversation underneath", async () => {
    const { lastFrame } = setup();
    await nextFrame();

    expect(lastFrame()).toContain("/home/dev/lantern");
    expect(lastFrame()).toContain("~$0.42");
  });

  it("moves to the next topic and starts at its first conversation", async () => {
    const { stdin, lastFrame } = setup();
    await nextFrame();
    await press(stdin, ARROW_RIGHT);

    expect(lastFrame()).toContain("Router DHCP");
    expect(lastFrame()).toContain("codex");
  });

  it("copies the conversation id straight from the board", async () => {
    const { stdin, onRun } = setup();
    await nextFrame();
    await press(stdin, "c");

    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ kind: "copy", text: "s-refund" }));
  });

  /** Printing and resuming both need the screen back, so the caller finishes them. */
  it("hands the terminal back before printing the command", async () => {
    const { stdin, onLeave } = setup();
    await nextFrame();
    await press(stdin, "p");

    expect(onLeave).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "print", text: `claude --resume "s-refund"` }),
    );
  });

  it("hands over to claude when resuming in place", async () => {
    const { stdin, onLeave } = setup();
    await nextFrame();
    await press(stdin, "R");

    expect(onLeave).toHaveBeenCalledWith({
      kind: "handoff",
      binary: "claude",
      args: ["--resume", "s-refund"],
      cwd: "/home/dev/lantern",
    });
  });

  it("refuses to resume a conversation from a read-only CLI", async () => {
    const { stdin, onRun } = setup();
    await nextFrame();
    await press(stdin, ARROW_RIGHT);
    await press(stdin, "R");

    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ kind: "refused" }));
  });

  it("opens the action menu on enter", async () => {
    const { stdin, lastFrame } = setup();
    await nextFrame();
    await press(stdin, ENTER);

    expect(lastFrame()).toContain("Resume here");
    expect(lastFrame()).toContain("Copy the conversation id");
  });

  it("greys the resume actions out for a read-only conversation", async () => {
    const { stdin, lastFrame } = setup();
    await nextFrame();
    await press(stdin, ARROW_RIGHT);
    await press(stdin, ENTER);

    expect(lastFrame()).toContain("read-only source");
  });

  it("narrows the board as the filter is typed", async () => {
    const { stdin, lastFrame } = setup();
    await nextFrame();
    await press(stdin, "/");
    await press(stdin, "router");

    expect(lastFrame()).toContain("Router DHCP");
    expect(lastFrame()).not.toContain("Add refunds");
  });

  it("says so when nothing matches, rather than showing an empty board", async () => {
    const { stdin, lastFrame } = setup();
    await nextFrame();
    await press(stdin, "/");
    await press(stdin, "zzz");

    expect(lastFrame()).toContain("Nothing matches");
  });

  it("lists the keys on ?", async () => {
    const { stdin, lastFrame } = setup();
    await nextFrame();
    await press(stdin, "?");

    expect(lastFrame()).toContain("Keys");
    expect(lastFrame()).toContain("resume here, replacing this screen");
  });

  it("asks for a re-read on r", async () => {
    const { stdin, onRefresh } = setup();
    await nextFrame();
    await press(stdin, "r");

    expect(onRefresh).toHaveBeenCalled();
  });

  it("says how many conversations were left out when the list was capped", async () => {
    const { lastFrame } = setup({ total: 900 });
    await nextFrame();

    expect(lastFrame()).toContain("of 900");
  });

  it("copes with having nothing to show at all", async () => {
    const { lastFrame } = setup({ topics: [], conversations: [], total: 0 });
    await nextFrame();

    expect(lastFrame()).toContain("No conversations found.");
  });

  it("moves down a column", async () => {
    const { stdin, onRun } = setup();
    await nextFrame();
    await press(stdin, ARROW_DOWN);
    await press(stdin, "c");

    expect(onRun).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "copy", text: "s-checkout" }),
    );
  });

  it("shows what Enter will do", async () => {
    const { lastFrame } = setup();
    await nextFrame();

    expect(plain(lastFrame())).toContain("enter: resume here");
    expect(plain(lastFrame())).toContain("e to change");
  });

  it("cycles what Enter does, and remembers it", async () => {
    const { stdin, lastFrame, onDefaultActionChange } = setup();
    await nextFrame();
    await press(stdin, "e");

    expect(plain(lastFrame())).toContain("enter: open a new window");
    expect(onDefaultActionChange).toHaveBeenCalledWith("new-window");
  });

  it("wraps back round to the first choice", async () => {
    const { stdin, lastFrame } = setup();
    await nextFrame();
    for (let index = 0; index < 4; index += 1) {
      await press(stdin, "e");
    }

    expect(plain(lastFrame())).toContain("enter: resume here");
  });

  it("uses the newly chosen action for Enter", async () => {
    const { stdin, onRun } = setup();
    await nextFrame();
    // resume-here -> new-window -> print -> copy-id
    await press(stdin, "e");
    await press(stdin, "e");
    await press(stdin, "e");
    await press(stdin, ENTER);
    await press(stdin, ENTER);

    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ kind: "copy" }));
  });

  /**
   * `claude --resume` finds a session by the directory it ran in, so a
   * conversation Lantern has no directory for cannot be resumed anywhere.
   */
  it("refuses to resume a conversation with no known directory", async () => {
    const { stdin, onRun } = setup({
      conversations: [{ ...conversation("s-orphan", "api", "Orphan"), projectPath: null }],
      topics: [topics[0] ?? { id: "api", label: "Orders API", icon: "plug", count: 1 }],
    });
    await nextFrame();
    await press(stdin, "R");

    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ kind: "refused" }));
  });
});

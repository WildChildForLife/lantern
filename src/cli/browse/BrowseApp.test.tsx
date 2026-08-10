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
  const onResume = vi.fn().mockResolvedValue({ text: "Back from the session.", tone: "info" });
  const onRefresh = vi.fn();
  const onDefaultActionChange = vi.fn();
  const onPrint = vi.fn();
  const onClassify = vi.fn().mockResolvedValue({ text: "Sorted 2 into topics.", tone: "ok" });

  const result = render(
    <BrowseApp
      topics={topics}
      conversations={conversations}
      total={conversations.length}
      interactiveSources={["claude-code"]}
      executable={undefined}
      defaultAction="resume-here"
      onDefaultActionChange={onDefaultActionChange}
      now={new Date("2026-08-07T00:00:00.000Z")}
      onRun={onRun}
      onResume={onResume}
      onRefresh={onRefresh}
      onClassify={onClassify}
      onPrint={onPrint}
      refreshing={false}
      {...overrides}
    />,
  );

  return { ...result, onRun, onResume, onRefresh, onDefaultActionChange, onPrint, onClassify };
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

  /** Printing used to end the session; it is shown on the board instead now. */
  it("shows the command without giving up the screen", async () => {
    const { stdin, onResume, onPrint } = setup({ onRun: vi.fn().mockResolvedValue(null) });
    await nextFrame();
    await press(stdin, "p");

    expect(onPrint).toHaveBeenCalledWith({
      cwd: "/home/dev/lantern",
      text: `claude --resume "s-refund"`,
    });
    expect(onResume).not.toHaveBeenCalled();
  });

  /**
   * A command whose directory has gone cannot work, and showing it anyway would
   * hand the user something to paste that reports the conversation as missing.
   */
  it("does not show a command the directory check turned down", async () => {
    const { stdin, onPrint } = setup({
      onRun: vi.fn().mockResolvedValue({ text: "that folder has gone", tone: "error" }),
    });
    await nextFrame();
    await press(stdin, "p");

    expect(onPrint).not.toHaveBeenCalled();
  });

  it("draws the command it was given, under the board", async () => {
    const { lastFrame } = setup({
      printed: { cwd: "/home/dev/lantern", text: `claude --resume "s-refund"`, token: 1 },
    });
    await nextFrame();

    expect(plain(lastFrame())).toContain(`claude --resume "s-refund"`);
    expect(plain(lastFrame())).toContain("cd /home/dev/lantern");
  });

  it("lends the terminal to claude when resuming in place", async () => {
    const { stdin, onResume } = setup();
    await nextFrame();
    await press(stdin, "R");

    expect(onResume).toHaveBeenCalledWith({
      kind: "handoff",
      binary: "claude",
      args: ["--resume", "s-refund"],
      cwd: "/home/dev/lantern",
    });
  });

  /**
   * The board is suspended for the session rather than unmounted, so coming back
   * to the same conversation is not a restore — there is nothing to restore.
   */
  it("is still on the same conversation after the session ends", async () => {
    const { stdin, onResume, onRun } = setup();
    await nextFrame();
    await press(stdin, ARROW_DOWN);
    await press(stdin, "R");

    expect(onResume).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["--resume", "s-checkout"] }),
    );

    await press(stdin, "c");
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ text: "s-checkout" }));
  });

  it("keeps the filter that was in force before the session", async () => {
    const { stdin, lastFrame } = setup();
    await nextFrame();
    await press(stdin, "/");
    await press(stdin, "router");
    await press(stdin, ENTER);
    await press(stdin, "R");
    await nextFrame();

    expect(lastFrame()).toContain("Router DHCP");
    expect(lastFrame()).not.toContain("Add refunds");
  });

  it("says how the session that just ended went", async () => {
    const { stdin, lastFrame } = setup({
      onResume: vi
        .fn()
        .mockResolvedValue({ text: "The session exited with code 3.", tone: "error" }),
    });
    await nextFrame();
    await press(stdin, "R");
    await nextFrame();

    expect(lastFrame()).toContain("The session exited with code 3.");
  });

  /** The conversation that just ended has grown, so the board re-reads the logs. */
  it("re-reads the logs on the way back from a session", async () => {
    const { stdin, onRefresh } = setup();
    await nextFrame();
    await press(stdin, "R");
    await nextFrame();

    expect(onRefresh).toHaveBeenCalled();
  });

  it("refuses to resume a conversation from a read-only CLI", async () => {
    const { stdin, onRun } = setup();
    await nextFrame();
    await press(stdin, ARROW_RIGHT);
    await press(stdin, "R");

    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ kind: "refused" }));
  });

  /** The header already says what Enter does; a menu of the same three repeats it. */
  it("does the header's action on enter, without asking again", async () => {
    const { stdin, onResume } = setup();
    await nextFrame();
    await press(stdin, ENTER);

    expect(onResume).toHaveBeenCalledWith(expect.objectContaining({ kind: "handoff" }));
  });

  it("says why on enter when the conversation is from a read-only CLI", async () => {
    const { stdin, onRun } = setup();
    await nextFrame();
    await press(stdin, ARROW_RIGHT);
    await press(stdin, ENTER);

    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ kind: "refused" }));
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
    expect(lastFrame()).toContain("resume here, and come back to the board after");
  });

  /** The key list is what people go to; a removed action must not still be in it. */
  it("no longer offers a new terminal window", async () => {
    const { stdin, lastFrame } = setup();
    await nextFrame();
    await press(stdin, "?");

    expect(plain(lastFrame())).not.toContain("new terminal window");
  });

  it("sorts the conversations with no topic on t", async () => {
    const { stdin, onClassify } = setup();
    await nextFrame();
    await press(stdin, "t");

    expect(onClassify).toHaveBeenCalledWith("unclassified");
  });

  it("says what the pass did, and re-reads the logs after it", async () => {
    const { stdin, lastFrame, onRefresh } = setup();
    await nextFrame();
    await press(stdin, "t");
    await nextFrame();

    expect(lastFrame()).toContain("Sorted 2 into topics.");
    expect(onRefresh).toHaveBeenCalled();
  });

  /** A pass costs a CLI call and takes a while; the board has to say it is running. */
  it("says a pass is running while it runs", async () => {
    const { stdin, lastFrame } = setup({
      onClassify: vi.fn().mockReturnValue(new Promise(() => undefined)),
    });
    await nextFrame();
    await press(stdin, "t");

    expect(plain(lastFrame())).toContain("sorting into topics…");
  });

  it("does not start a second pass over the first", async () => {
    const running = vi.fn().mockReturnValue(new Promise(() => undefined));
    const { stdin } = setup({ onClassify: running });
    await nextFrame();
    await press(stdin, "t");
    await press(stdin, "t");

    expect(running).toHaveBeenCalledTimes(1);
  });

  it("says so when a pass fails outright", async () => {
    const { stdin, lastFrame } = setup({
      onClassify: vi.fn().mockRejectedValue(new Error("no CLI configured")),
    });
    await nextFrame();
    await press(stdin, "t");
    await nextFrame();

    expect(lastFrame()).toContain("Could not sort the conversations");
  });

  /** Redoing every topic throws away work already paid for, so T asks first. */
  it("asks before redoing every topic, and only sorts on y", async () => {
    const { stdin, lastFrame, onClassify } = setup();
    await nextFrame();
    await press(stdin, "T");

    expect(plain(lastFrame())).toContain("Throw away every topic and sort again?");
    expect(onClassify).not.toHaveBeenCalled();

    await press(stdin, "y");
    expect(onClassify).toHaveBeenCalledWith("all");
  });

  it("leaves the topics alone when the question is answered with anything else", async () => {
    const { stdin, lastFrame, onClassify } = setup();
    await nextFrame();
    await press(stdin, "T");
    await press(stdin, ENTER);

    expect(plain(lastFrame())).not.toContain("Throw away every topic");
    expect(onClassify).not.toHaveBeenCalled();
  });

  /**
   * On its own row, not among the movement keys: sorting is the one key on the
   * board that spends a CLI call, and listed with the rest it read as another way
   * to move around.
   */
  it("asks for the sort on a row of its own, away from the key line", async () => {
    const { lastFrame } = setup({ unclassified: 7 });
    await nextFrame();

    const lines = plain(lastFrame()).split("\n");
    const callout = lines.findIndex((line) => line.includes("sort 7 conversations into topics"));
    const keys = lines.findIndex((line) => line.includes("←→ topics"));

    expect(callout).toBeGreaterThan(-1);
    expect(keys).toBeGreaterThan(callout);
    expect(lines[keys]).not.toContain("sort");
  });

  /** A standing invitation to spend a CLI call on an empty pass is worse than none. */
  it("says nothing about sorting when everything has a topic", async () => {
    const { lastFrame } = setup({ unclassified: 0 });
    await nextFrame();

    expect(plain(lastFrame())).not.toContain("into topics");
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
  });

  /**
   * The header used to be a row of separate Texts, each wrapping on its own,
   * which split "Lantern" down the middle on a narrow terminal.
   */
  it("keeps the header on one line", async () => {
    const { lastFrame } = setup({ unclassified: 69, total: 900 });
    await nextFrame();

    const header = plain(lastFrame()).split("\n")[0] ?? "";

    expect(header).toContain("Lantern");
    expect(header).toContain("3 conversations of 900");
    expect(header).toContain("enter: resume here");
  });

  /** `e` is on the key line and in the help; the header only says what Enter does now. */
  it("does not spend header width teaching the key", async () => {
    const { lastFrame } = setup();
    await nextFrame();

    expect(plain(lastFrame())).not.toContain("e to change");
  });

  it("cycles what Enter does, and remembers it", async () => {
    const { stdin, lastFrame, onDefaultActionChange } = setup();
    await nextFrame();
    await press(stdin, "e");

    expect(plain(lastFrame())).toContain("enter: print the command");
    expect(onDefaultActionChange).toHaveBeenCalledWith("print");
  });

  it("wraps back round to the first choice", async () => {
    const { stdin, lastFrame } = setup();
    await nextFrame();
    for (let index = 0; index < 3; index += 1) {
      await press(stdin, "e");
    }

    expect(plain(lastFrame())).toContain("enter: resume here");
  });

  it("uses the newly chosen action for Enter", async () => {
    const { stdin, onRun } = setup();
    await nextFrame();
    // resume-here -> print -> copy-id
    await press(stdin, "e");
    await press(stdin, "e");
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

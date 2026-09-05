import { describe, expect, it } from "vitest";
import { resolveKeyAction } from "./keymap.ts";

const press = (input: string, key: Record<string, boolean> = {}) => ({ input, ...key });

describe("resolveKeyAction on the board", () => {
  it.each([
    ["h", -1],
    ["l", 1],
  ])("moves between columns with %s", (input, delta) => {
    expect(resolveKeyAction(press(input), "board")).toStrictEqual({ type: "move-column", delta });
  });

  it("moves between columns with the arrow keys", () => {
    expect(resolveKeyAction(press("", { leftArrow: true }), "board")).toStrictEqual({
      type: "move-column",
      delta: -1,
    });
    expect(resolveKeyAction(press("", { rightArrow: true }), "board")).toStrictEqual({
      type: "move-column",
      delta: 1,
    });
  });

  it.each([
    ["j", 1],
    ["k", -1],
  ])("moves between rows with %s", (input, delta) => {
    expect(resolveKeyAction(press(input), "board")).toStrictEqual({ type: "move-row", delta });
  });

  /** A column can be forty conversations long; `j` forty times is not a way down it. */
  it("moves a screenful at a time with the page keys", () => {
    expect(resolveKeyAction(press("", { pageUp: true }), "board")).toStrictEqual({
      type: "move-row-page",
      direction: -1,
    });
    expect(resolveKeyAction(press("", { pageDown: true }), "board")).toStrictEqual({
      type: "move-row-page",
      direction: 1,
    });
  });

  it("moves a screenful with Ctrl-U and Ctrl-D, for the keyboards without page keys", () => {
    expect(resolveKeyAction(press("u", { ctrl: true }), "board")).toStrictEqual({
      type: "move-row-page",
      direction: -1,
    });
    expect(resolveKeyAction(press("d", { ctrl: true }), "board")).toStrictEqual({
      type: "move-row-page",
      direction: 1,
    });
  });

  /** `p` prints the resume command; Ctrl-P is a different key and means nothing. */
  it("does not read a modified key as the letter on it", () => {
    expect(resolveKeyAction(press("p", { ctrl: true }), "board")).toBeNull();
  });

  it("jumps to the ends of a column", () => {
    expect(resolveKeyAction(press("g"), "board")).toStrictEqual({
      type: "row-edge",
      edge: "first",
    });
    expect(resolveKeyAction(press("G"), "board")).toStrictEqual({ type: "row-edge", edge: "last" });
  });

  it("opens the search", () => {
    expect(resolveKeyAction(press("/"), "board")).toStrictEqual({ type: "open-filter" });
  });

  /** A query outlives the bar being open, so escape has something to clear. */
  it("closes on escape even with nothing open", () => {
    expect(resolveKeyAction(press("", { escape: true }), "board")).toStrictEqual({
      type: "close-overlay",
    });
  });

  /** The header says what Enter does; opening a menu of the same four would repeat it. */
  it("runs the chosen action on Enter, without a menu", () => {
    expect(resolveKeyAction(press("", { return: true }), "board")).toStrictEqual({
      type: "run-chosen",
    });
  });

  it("cycles the chosen action on e", () => {
    expect(resolveKeyAction(press("e"), "board")).toStrictEqual({ type: "cycle-enter-action" });
  });

  /** Every action also has its own key, so none of them needs the header changed first. */
  it.each([
    ["c", "copy-id"],
    ["p", "print"],
    ["R", "resume-here"],
  ])("runs %s directly", (input, action) => {
    expect(resolveKeyAction(press(input), "board")).toStrictEqual({ type: "run", action });
  });

  /** Opening a second terminal window was removed; `o` means nothing now. */
  it("has nothing bound to o", () => {
    expect(resolveKeyAction(press("o"), "board")).toBeNull();
  });

  it("refreshes and shows help", () => {
    expect(resolveKeyAction(press("r"), "board")).toStrictEqual({ type: "refresh" });
    expect(resolveKeyAction(press("?"), "board")).toStrictEqual({ type: "toggle-help" });
  });

  it("sorts the conversations with no topic on t", () => {
    expect(resolveKeyAction(press("t"), "board")).toStrictEqual({
      type: "classify",
      scope: "unclassified",
    });
  });

  /** T does not sort on its own: it opens the question, and `y` answers it. */
  it("asks before redoing every topic", () => {
    expect(resolveKeyAction(press("T"), "board")).toStrictEqual({ type: "ask-resort-all" });
  });

  it.each([["q"], ["Q"]])("quits on %s", (input) => {
    expect(resolveKeyAction(press(input), "board")).toStrictEqual({ type: "quit" });
  });

  it("quits on Ctrl-C", () => {
    expect(resolveKeyAction(press("c", { ctrl: true }), "board")).toStrictEqual({ type: "quit" });
  });

  it("ignores a key it has no use for", () => {
    expect(resolveKeyAction(press("z"), "board")).toBeNull();
  });
});

describe("resolveKeyAction while typing a filter", () => {
  /** Every other key belongs to the text field, which owns its own editing. */
  it("hands ordinary keys back to the text field", () => {
    expect(resolveKeyAction(press("q"), "filter")).toBeNull();
    expect(resolveKeyAction(press("/"), "filter")).toBeNull();
  });

  it("closes on Enter and on Escape", () => {
    expect(resolveKeyAction(press("", { return: true }), "filter")).toStrictEqual({
      type: "close-overlay",
    });
    expect(resolveKeyAction(press("", { escape: true }), "filter")).toStrictEqual({
      type: "close-overlay",
    });
  });

  it("still quits on Ctrl-C", () => {
    expect(resolveKeyAction(press("c", { ctrl: true }), "filter")).toStrictEqual({ type: "quit" });
  });
});

describe("resolveKeyAction with the resort question open", () => {
  it.each([["y"], ["Y"]])("redoes every topic on %s", (input) => {
    expect(resolveKeyAction(press(input), "confirm-resort")).toStrictEqual({
      type: "classify",
      scope: "all",
    });
  });

  /**
   * Everything else backs out, Enter included: it is the key most likely to be
   * pressed by reflex, and this is the one action that throws work away.
   */
  it.each([["n"], ["q"], ["z"]])("leaves the topics alone on %s", (input) => {
    expect(resolveKeyAction(press(input), "confirm-resort")).toStrictEqual({
      type: "close-overlay",
    });
  });

  it("leaves the topics alone on Enter and on Escape", () => {
    expect(resolveKeyAction(press("", { return: true }), "confirm-resort")).toStrictEqual({
      type: "close-overlay",
    });
    expect(resolveKeyAction(press("", { escape: true }), "confirm-resort")).toStrictEqual({
      type: "close-overlay",
    });
  });

  it("still quits on Ctrl-C", () => {
    expect(resolveKeyAction(press("c", { ctrl: true }), "confirm-resort")).toStrictEqual({
      type: "quit",
    });
  });
});

describe("resolveKeyAction with the help overlay open", () => {
  it("closes on any key", () => {
    expect(resolveKeyAction(press("z"), "help")).toStrictEqual({ type: "close-overlay" });
    expect(resolveKeyAction(press("", { escape: true }), "help")).toStrictEqual({
      type: "close-overlay",
    });
  });
});

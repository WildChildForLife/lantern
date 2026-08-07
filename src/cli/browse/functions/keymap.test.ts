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

  it("jumps to the ends of a column", () => {
    expect(resolveKeyAction(press("g"), "board")).toStrictEqual({
      type: "row-edge",
      edge: "first",
    });
    expect(resolveKeyAction(press("G"), "board")).toStrictEqual({ type: "row-edge", edge: "last" });
  });

  it("opens the filter", () => {
    expect(resolveKeyAction(press("/"), "board")).toStrictEqual({ type: "open-filter" });
  });

  it("opens the action menu on Enter", () => {
    expect(resolveKeyAction(press("", { return: true }), "board")).toStrictEqual({
      type: "open-menu",
    });
  });

  /** The menu is a convenience, not a toll gate: the actions have hotkeys too. */
  it.each([
    ["c", "copy-id"],
    ["p", "print"],
    ["o", "new-window"],
    ["R", "resume-here"],
  ])("runs %s directly", (input, action) => {
    expect(resolveKeyAction(press(input), "board")).toStrictEqual({ type: "run", action });
  });

  it("refreshes and shows help", () => {
    expect(resolveKeyAction(press("r"), "board")).toStrictEqual({ type: "refresh" });
    expect(resolveKeyAction(press("?"), "board")).toStrictEqual({ type: "toggle-help" });
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

describe("resolveKeyAction with the help overlay open", () => {
  it("closes on any key", () => {
    expect(resolveKeyAction(press("z"), "help")).toStrictEqual({ type: "close-overlay" });
    expect(resolveKeyAction(press("", { escape: true }), "help")).toStrictEqual({
      type: "close-overlay",
    });
  });
});

import { describe, expect, it } from "vitest";
import { describeUnknownCommand, type KnownCommand, nearestCommand } from "./unknownCommand.ts";

const known: KnownCommand[] = [
  { name: "browse", aliases: ["b"] },
  { name: "init", aliases: [] },
  { name: "upgrade", aliases: [] },
];

describe("nearestCommand", () => {
  it("finds the command behind a typo", () => {
    expect(nearestCommand("brows", known)).toBe("browse");
    expect(nearestCommand("borwse", known)).toBe("browse");
    expect(nearestCommand("upgade", known)).toBe("upgrade");
    expect(nearestCommand("iniit", known)).toBe("init");
  });

  it("looks past case", () => {
    expect(nearestCommand("Browse", known)).toBe("browse");
  });

  /**
   * An alias is a real way to spell the command, so a typo of one is a typo of
   * the command — but what comes back is the name, which is the half of the
   * pair worth printing.
   */
  it("matches aliases, and answers with the command's own name", () => {
    expect(nearestCommand("boad", [{ name: "browse", aliases: ["board"] }])).toBe("browse");
  });

  it("suggests nothing for a word that resembles no command", () => {
    expect(nearestCommand("sessions", known)).toBe(null);
    expect(nearestCommand("serve", known)).toBe(null);
  });

  /**
   * `lantern x` is a mistake with no obvious intent behind it. Every one-letter
   * word is a single edit from the `b` alias, so guessing here would answer
   * almost anything with "did you mean browse?".
   */
  it("does not guess from one or two letters", () => {
    expect(nearestCommand("x", known)).toBe(null);
    expect(nearestCommand("br", known)).toBe(null);
  });
});

describe("describeUnknownCommand", () => {
  /**
   * The one call site asks this question of every launch, including the plain
   * `lantern` that starts the web UI. Nothing typed, nothing to complain about.
   */
  it("has nothing to say when no command was typed", () => {
    expect(describeUnknownCommand([], known, "lantern")).toBe(null);
  });

  it("names what was typed, and what it probably meant", () => {
    const message = describeUnknownCommand(["brows"], known, "lantern");

    expect(message).toContain("unknown command 'brows'");
    expect(message).toContain("`lantern browse`");
  });

  it("still lists the commands when it has nothing to suggest", () => {
    const message = describeUnknownCommand(["sessions"], known, "lantern");

    expect(message).toContain("unknown command 'sessions'");
    expect(message).not.toContain("Did you mean");
    expect(message).toContain("browse, init, upgrade");
  });

  it("says how to start the web UI, which is the command that is not one", () => {
    const message = describeUnknownCommand(["sessions"], known, "lantern");

    expect(message).toContain("`lantern` on its own");
    expect(message).toContain("`lantern --help`");
  });

  /** Only the first word is the command; the rest were meant as its arguments. */
  it("reports the first word alone when several follow", () => {
    const message = describeUnknownCommand(["brows", "orders-api"], known, "lantern");

    expect(message).toContain("unknown command 'brows'");
    expect(message).not.toContain("orders-api");
  });

  it("uses the name the program was invoked under", () => {
    expect(describeUnknownCommand(["brows"], known, "lantern-viewer")).toContain(
      "`lantern-viewer browse`",
    );
  });
});

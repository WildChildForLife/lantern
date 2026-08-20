import { describe, expect, it } from "vitest";
import { describeCrash } from "./crash.ts";

describe("describeCrash", () => {
  it("says what happened without the word `error`", () => {
    const message = describeCrash(new Error("EADDRINUSE: address already in use"), false);

    expect(message).not.toContain("Error");
    expect(message).toContain("Lantern stopped unexpectedly");
  });

  it("keeps the one line that says what went wrong", () => {
    expect(describeCrash(new Error("EADDRINUSE: address already in use"), false)).toContain(
      "EADDRINUSE: address already in use",
    );
  });

  it("says how to see more, and where to report it", () => {
    const message = describeCrash(new Error("boom"), false);

    expect(message).toContain("--verbose");
    expect(message).toContain("github.com/WildChildForLife/lantern/issues");
  });

  /**
   * The stack is the thing worth having in a bug report, and the thing nobody
   * wants on screen by default. Asking for `--verbose` is asking for it.
   */
  it("holds the stack back until it is asked for", () => {
    const error = new Error("boom");
    error.stack = "Error: boom\n    at somewhere (file.ts:1:1)";

    expect(describeCrash(error, false)).not.toContain("at somewhere");
    expect(describeCrash(error, true)).toContain("at somewhere");
  });

  it("does not offer --verbose again to somebody who already passed it", () => {
    expect(describeCrash(new Error("boom"), true)).not.toContain("Run the same command");
  });

  /** Anything can be thrown, and a string has no `message` to read. */
  it("copes with something that is not an Error", () => {
    expect(describeCrash("just a string", false)).toContain("just a string");
    expect(describeCrash(undefined, false)).toContain("Lantern stopped unexpectedly");
  });
});

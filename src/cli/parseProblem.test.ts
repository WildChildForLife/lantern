import { describe, expect, it } from "vitest";
import { describeParseProblem } from "./parseProblem.ts";

describe("describeParseProblem", () => {
  it("drops the parser's `error:` prefix", () => {
    const message = describeParseProblem("error: unknown option '--bogus'", "lantern");

    expect(message).not.toContain("error");
    expect(message).toContain("unknown option '--bogus'");
  });

  it("says where the options are listed", () => {
    expect(describeParseProblem("error: unknown option '--bogus'", "lantern")).toContain(
      "`lantern --help`",
    );
  });

  it("names the command the problem came from, not always the program", () => {
    expect(describeParseProblem("error: unknown option '--bogus'", "lantern upgrade")).toContain(
      "`lantern upgrade --help`",
    );
  });

  /**
   * Commander adds its own suggestion after the message, on a second line. It
   * is the most useful part, so it has to survive the rewrite.
   */
  it("keeps a suggestion the parser made", () => {
    const message = describeParseProblem(
      "error: unknown option '--verbse'\n(Did you mean --verbose?)",
      "lantern",
    );

    expect(message).toContain("(Did you mean --verbose?)");
  });

  it("leaves a message that never said `error` alone", () => {
    expect(
      describeParseProblem("option '-p, --port <port>' argument missing", "lantern"),
    ).toContain("option '-p, --port <port>' argument missing");
  });

  /** Commander writes a trailing newline; the caller adds its own. */
  it("comes back without the trailing newline it was handed", () => {
    expect(describeParseProblem("error: unknown option '--bogus'\n", "lantern")).not.toMatch(/\n$/);
  });
});

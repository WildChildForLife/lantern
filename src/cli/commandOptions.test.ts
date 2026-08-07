import { describe, expect, it } from "vitest";
import { parseSharedOptions } from "./commandOptions.ts";

describe("parseSharedOptions", () => {
  it("reads the flags a subcommand shares with the root command", () => {
    expect(
      parseSharedOptions({
        claudeDir: "/srv/claude",
        executable: "/usr/bin/claude",
        verbose: true,
        source: ["claude-code", "codex"],
      }),
    ).toStrictEqual({
      claudeDir: "/srv/claude",
      executable: "/usr/bin/claude",
      verbose: true,
      source: ["claude-code", "codex"],
    });
  });

  /**
   * `optsWithGlobals()` hands back the root command's whole option bag, which
   * carries the server's flags too.
   */
  it("ignores the options that only mean something to the server", () => {
    expect(
      parseSharedOptions({ port: "3400", hostname: "0.0.0.0", password: "hunter2", apiOnly: true }),
    ).toStrictEqual({});
  });

  it("returns nothing rather than throwing on a shape it did not expect", () => {
    expect(parseSharedOptions({ claudeDir: 42 })).toStrictEqual({});
    expect(parseSharedOptions(null)).toStrictEqual({});
    expect(parseSharedOptions(undefined)).toStrictEqual({});
  });

  it("copes with a command that was given no flags at all", () => {
    expect(parseSharedOptions({})).toStrictEqual({});
  });
});

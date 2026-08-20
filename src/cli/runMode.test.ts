import { describe, expect, it } from "vitest";
import { describeRunModeConflict, resolveRunMode } from "./runMode.ts";

describe("describeRunModeConflict", () => {
  it("says what clashed without calling it an error", () => {
    const message = describeRunModeConflict("lantern");

    expect(message).not.toContain("error");
    expect(message).toContain("--cli-only and --server-only ask for opposite things");
  });

  /** The reader wanted one of three things; all three are spelled out. */
  it("shows every way of asking, so the reader can pick one", () => {
    const message = describeRunModeConflict("lantern");

    expect(message).toContain("lantern --cli-only");
    expect(message).toContain("lantern --server-only");
  });

  it("uses the name the program was invoked under", () => {
    expect(describeRunModeConflict("lantern-viewer")).toContain("lantern-viewer --cli-only");
  });
});

describe("resolveRunMode", () => {
  it("reports a conflict when both flags are given", () => {
    expect(resolveRunMode({ cliOnly: true, serverOnly: true, interactive: true })).toBe("conflict");
  });

  it("reports a conflict even without a terminal", () => {
    expect(resolveRunMode({ cliOnly: true, serverOnly: true, interactive: false })).toBe(
      "conflict",
    );
  });

  it("runs the board alone when --cli-only is given", () => {
    expect(resolveRunMode({ cliOnly: true, serverOnly: false, interactive: true })).toBe("cli");
  });

  it("still asks for the board without a terminal, so the board can say why not", () => {
    expect(resolveRunMode({ cliOnly: true, serverOnly: false, interactive: false })).toBe("cli");
  });

  it("runs the server alone when --server-only is given", () => {
    expect(resolveRunMode({ cliOnly: false, serverOnly: true, interactive: true })).toBe("server");
  });

  it("runs both when neither flag is given at a terminal", () => {
    expect(resolveRunMode({ cliOnly: false, serverOnly: false, interactive: true })).toBe("both");
  });

  it("falls back to the server alone when there is no terminal to draw on", () => {
    expect(resolveRunMode({ cliOnly: false, serverOnly: false, interactive: false })).toBe(
      "server",
    );
  });
});

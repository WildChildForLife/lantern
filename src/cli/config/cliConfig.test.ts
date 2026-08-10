import { describe, expect, it } from "vitest";
import { defaultCliConfig, parseCliConfig } from "./cliConfig.ts";

describe("parseCliConfig", () => {
  it("fills in defaults for a file that only sets one thing", () => {
    expect(parseCliConfig({ port: 3400 })).toStrictEqual({
      ...defaultCliConfig,
      port: 3400,
    });
  });

  it("defaults browse to resuming in the current terminal", () => {
    expect(defaultCliConfig.browse.resumeAction).toBe("resume-here");
  });

  /** The file is meant to be hand-editable, and a quoted port is the obvious slip. */
  it("accepts a port written as a string", () => {
    expect(parseCliConfig({ port: "3400" })?.port).toBe(3400);
  });

  it("rejects a port outside the valid range", () => {
    expect(parseCliConfig({ port: 70000 })).toBeNull();
  });

  it("drops keys it does not know rather than refusing the file", () => {
    const parsed = parseCliConfig({ hostname: "0.0.0.0", somethingElse: true });

    expect(parsed?.hostname).toBe("0.0.0.0");
    expect(parsed).not.toHaveProperty("somethingElse");
  });

  /**
   * A password in a plaintext file is a footgun the wizard deliberately avoids,
   * so the schema refuses to carry one even if somebody adds it by hand.
   */
  it("never carries a password", () => {
    expect(parseCliConfig({ password: "hunter2" })).not.toHaveProperty("password");
  });

  it("returns null for a value that is not an object at all", () => {
    expect(parseCliConfig("nope")).toBeNull();
    expect(parseCliConfig(null)).toBeNull();
  });

  it("rejects a resume action it does not implement", () => {
    expect(parseCliConfig({ browse: { resumeAction: "teleport" } })).toBeNull();
  });
});

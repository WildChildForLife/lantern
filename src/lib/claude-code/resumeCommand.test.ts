import { describe, expect, it } from "vitest";
import { buildResumeCommand } from "./resumeCommand.ts";

describe("buildResumeCommand", () => {
  it("resumes a conversation with the default binary", () => {
    expect(buildResumeCommand("abc-123")).toBe(`claude --resume "abc-123"`);
  });

  it("uses a configured executable path", () => {
    expect(buildResumeCommand("abc", "/usr/local/bin/claude")).toBe(
      `/usr/local/bin/claude --resume "abc"`,
    );
  });

  /** A Windows install path has spaces in it more often than not. */
  it("quotes an executable path that needs it", () => {
    expect(buildResumeCommand("abc", "C:/Program Files/claude.exe")).toBe(
      `"C:/Program Files/claude.exe" --resume "abc"`,
    );
  });

  it("falls back to the default binary for an empty executable", () => {
    expect(buildResumeCommand("abc", "")).toBe(`claude --resume "abc"`);
  });

  it("escapes a session id rather than trusting it", () => {
    expect(buildResumeCommand('a"; rm -rf /')).toBe(`claude --resume "a\\"; rm -rf /"`);
  });
});

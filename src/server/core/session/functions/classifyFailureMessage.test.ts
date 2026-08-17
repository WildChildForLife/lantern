import { describe, expect, test } from "vitest";
import { classifyFailureMessage } from "./classifyFailureMessage.ts";

describe("classifyFailureMessage", () => {
  test("says nothing about a pass that did not fail", () => {
    expect(classifyFailureMessage(null, null)).toBeNull();
    expect(classifyFailureMessage(null, "ignored")).toBeNull();
  });

  test("repeats what stopped the CLI from being asked", () => {
    expect(
      classifyFailureMessage("cli-unavailable", "Claude Code CLI not found - pass --executable"),
    ).toBe("Claude Code CLI not found - pass --executable");
  });

  test("still explains itself when the CLI failed without saying why", () => {
    expect(classifyFailureMessage("cli-unavailable", null)).toBe("the agent CLI could not be run");
    expect(classifyFailureMessage("cli-unavailable", "   ")).toBe("the agent CLI could not be run");
  });

  test("keeps a long CLI complaint to one line", () => {
    const detail = `Command failed\n${"x".repeat(400)}`;

    const message = classifyFailureMessage("cli-unavailable", detail);

    expect(message).toBe("Command failed");
  });

  test("names an answer it could not read as topics", () => {
    expect(classifyFailureMessage("unusable-answer", null)).toBe(
      "the agent CLI answered with nothing that could be read as topics",
    );
  });
});

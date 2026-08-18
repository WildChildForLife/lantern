import { expect, test } from "vitest";
import type { Conversation } from "@/lib/conversation-schema";
import { describeSystemEntry } from "./systemEntryPresentation";

const base = {
  type: "system",
  parentUuid: null,
  isSidechain: false,
  userType: "external",
  cwd: "/repo",
  sessionId: "session-1",
  version: "2.1.220",
  uuid: "uuid-1",
  timestamp: "2026-08-17T17:30:31.999Z",
} as const satisfies Partial<Extract<Conversation, { type: "system" }>> & { type: "system" };

test("a recap reads as a recap, opened, with no subtype tag", () => {
  const presentation = describeSystemEntry({
    ...base,
    subtype: "away_summary",
    content: "Goal: fix the README ordering. Done.",
  });

  expect(presentation.label).toBe("recap");
  expect(presentation.body).toBe("Goal: fix the README ordering. Done.");
  expect(presentation.defaultOpen).toBe(true);
  expect(presentation.body).not.toContain("away_summary");
});

test("an API error is called an error and shows the message first", () => {
  const presentation = describeSystemEntry({
    ...base,
    subtype: "api_error",
    level: "error",
    error: { status: 529, error: { message: "Overloaded" } },
    retryAttempt: 2,
    maxRetries: 5,
    retryInMs: 4000,
  });

  expect(presentation.tone).toBe("error");
  expect(presentation.body.split("\n")).toEqual(["Overloaded", "HTTP 529", "Retry 2/5 in 4.0s"]);
});

test("turn duration is a duration, not a field dump", () => {
  const presentation = describeSystemEntry({
    ...base,
    subtype: "turn_duration",
    durationMs: 324404,
  });

  expect(presentation.body).toBe("324.4s");
  expect(presentation.defaultOpen).toBe(false);
});

test("stop hooks keep the detail that explains what ran", () => {
  const presentation = describeSystemEntry({
    ...base,
    subtype: "stop_hook_summary",
    toolUseID: "tool-1",
    level: "info",
    hookCount: 1,
    hookInfos: [{ command: "pnpm lint" }],
    hookErrors: [],
    preventedContinuation: false,
    stopReason: "completed",
    hasOutput: true,
  });

  expect(presentation.body).toContain("pnpm lint");
  expect(presentation.body).not.toContain("Has Output");
});

test("an entry with no subtype falls back to a plain heading", () => {
  const presentation = describeSystemEntry({
    ...base,
    content: "some legacy notice",
    toolUseID: "tool-1",
    level: "info",
  });

  expect(presentation.label).toBe("generic");
  expect(presentation.body).toBe("some legacy notice");
});

import { expect, test } from "vitest";
import { getConversationVisibility, isMessageEntry } from "./entryVisibility.ts";
import type { Conversation } from "./index.ts";

const baseMessageFields = {
  parentUuid: null,
  isSidechain: false,
  userType: "external",
  cwd: "/repo",
  sessionId: "session-1",
  version: "2.1.220",
  uuid: "uuid-1",
  timestamp: "2026-08-17T17:30:31.999Z",
} as const;

const userEntry: Conversation = {
  ...baseMessageFields,
  type: "user",
  message: { role: "user", content: "hello" },
};

const assistantEntry: Conversation = {
  ...baseMessageFields,
  type: "assistant",
  uuid: "uuid-2",
  message: {
    id: "msg-1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [{ type: "text", text: "hi" }],
  },
};

test("what the person saw stays in the transcript", () => {
  expect(getConversationVisibility(userEntry)).toBe("transcript");
  expect(getConversationVisibility(assistantEntry)).toBe("transcript");
  expect(getConversationVisibility({ type: "summary", summary: "recap", leafUuid: "uuid-1" })).toBe(
    "transcript",
  );
});

test("a compaction notice is part of the story, its timing is not", () => {
  expect(
    getConversationVisibility({
      ...baseMessageFields,
      type: "system",
      subtype: "compact_boundary",
      content: "Conversation compacted",
      level: "info",
    }),
  ).toBe("transcript");

  expect(
    getConversationVisibility({
      ...baseMessageFields,
      type: "system",
      subtype: "turn_duration",
      durationMs: 324404,
    }),
  ).toBe("technical");
});

test("queued prompts and file backups are kept, behind the toggle", () => {
  expect(
    getConversationVisibility({
      type: "queue-operation",
      operation: "enqueue",
      sessionId: "session-1",
      timestamp: "2026-08-17T17:30:31.999Z",
      content: "run the tests",
    }),
  ).toBe("technical");

  expect(
    getConversationVisibility({
      type: "file-history-snapshot",
      messageId: "msg-1",
      snapshot: { messageId: "msg-1", trackedFileBackups: {}, timestamp: "2026-08-17T17:30:31Z" },
      isSnapshotUpdate: false,
    }),
  ).toBe("technical");
});

test("bookkeeping the CLI never showed is never shown here either", () => {
  const bookkeeping: Conversation[] = [
    { type: "mode", mode: "normal", sessionId: "session-1" },
    { type: "relocated", sessionId: "session-1", relocatedCwd: "/repo/.claude/worktrees/x" },
    { type: "worktree-state", sessionId: "session-1", worktreeSession: { worktreeName: "x" } },
    {
      type: "file-history-delta",
      messageId: "msg-1",
      snapshotMessageId: "msg-0",
      trackingPath: "README.md",
      backup: { backupFileName: null, version: 1 },
      timestamp: "2026-08-17T17:30:31.999Z",
    },
    {
      type: "frame-link",
      sessionId: "session-1",
      path: "/tmp/report.html",
      frameUrl: "https://claude.ai/code/artifact/abc",
    },
    { type: "permission-mode", permissionMode: "default", sessionId: "session-1" },
    { type: "last-prompt", sessionId: "session-1", leafUuid: "uuid-1" },
  ];

  for (const entry of bookkeeping) {
    expect(getConversationVisibility(entry)).toBe("internal");
  }
});

test("only message entries carry a message identity", () => {
  expect(isMessageEntry(userEntry)).toBe(true);
  expect(isMessageEntry(assistantEntry)).toBe(true);
  expect(isMessageEntry({ type: "mode", mode: "normal", sessionId: "session-1" })).toBe(false);
});

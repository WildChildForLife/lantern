import { describe, expect, it } from "vitest";
import type { Conversation } from "@/lib/conversation-schema";
import type { ErrorJsonl } from "@/server/core/types";
import {
  buildRenderableConversationRows,
  getConversationKey,
  shouldRenderInTranscript,
} from "./conversationRows";

type UserConversation = Extract<Conversation, { type: "user" }>;
type QueueOperationConversation = Extract<Conversation, { type: "queue-operation" }>;

const createUserConversation = (uuid: string): UserConversation => ({
  type: "user",
  uuid,
  timestamp: "2024-01-01T00:00:00.000Z",
  message: { role: "user", content: "hello" },
  isSidechain: false,
  userType: "external",
  cwd: "/tmp",
  sessionId: "session-1",
  version: "1.0.0",
  parentUuid: null,
});

const createQueueOperationConversation = (): QueueOperationConversation => ({
  type: "queue-operation",
  operation: "dequeue",
  sessionId: "session-1",
  timestamp: "2024-01-01T00:00:02.000Z",
});

const createSchemaErrorConversation = (): ErrorJsonl => ({
  type: "x-error",
  line: "{ invalid json",
  lineNumber: 7,
});

describe("conversationRows", () => {
  it("builds renderable rows while preserving schema errors", () => {
    const schemaError = createSchemaErrorConversation();
    const userConversation = createUserConversation("550e8400-e29b-41d4-a716-446655440000");
    const customTitleConversation: Conversation = {
      type: "custom-title",
      customTitle: "Session title",
      sessionId: "session-1",
    };

    const rows = buildRenderableConversationRows(
      [schemaError, userConversation, customTitleConversation],
      (conversation) => conversation.type !== "user",
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]?.rowKey).toBe("error_7");
    expect(rows[0]?.conversation.type).toBe("x-error");
    expect(rows[1]?.rowKey).toBe("custom-title_session-1_Session title");
  });

  it("sets timestamp visibility by conversation type", () => {
    const userConversation = createUserConversation("550e8400-e29b-41d4-a716-446655440001");
    const queueConversation = createQueueOperationConversation();

    const aiTitleConversation: Conversation = {
      type: "ai-title",
      aiTitle: "AI title",
      sessionId: "session-1",
    };

    const rows = buildRenderableConversationRows(
      [userConversation, queueConversation, aiTitleConversation],
      () => true,
    );

    expect(rows).toHaveLength(3);
    expect(rows[0]?.showTimestamp).toBe(true);
    expect(rows[1]?.showTimestamp).toBe(false);
    expect(rows[2]?.showTimestamp).toBe(false);
  });

  it("generates stable keys for conversation entries", () => {
    const userConversation = createUserConversation("550e8400-e29b-41d4-a716-446655440002");

    const aiTitleConversation: Conversation = {
      type: "ai-title",
      aiTitle: "AI title",
      sessionId: "session-1",
    };

    expect(getConversationKey(userConversation)).toBe("user_550e8400-e29b-41d4-a716-446655440002");
    expect(getConversationKey(aiTitleConversation)).toBe("ai-title_session-1_AI title");
  });
});

describe("shouldRenderInTranscript", () => {
  const off = { showTechnicalDetails: false };
  const on = { showTechnicalDetails: true };

  it("keeps what the person saw", () => {
    expect(shouldRenderInTranscript(createUserConversation("uuid-1"), off)).toBe(true);
  });

  it("always surfaces lines Lantern could not parse", () => {
    expect(shouldRenderInTranscript(createSchemaErrorConversation(), off)).toBe(true);
  });

  it("holds plumbing back until it is asked for", () => {
    const queueOperation = createQueueOperationConversation();
    expect(shouldRenderInTranscript(queueOperation, off)).toBe(false);
    expect(shouldRenderInTranscript(queueOperation, on)).toBe(true);
  });

  it("never renders bookkeeping, at either setting", () => {
    const worktreeState: Conversation = {
      type: "worktree-state",
      sessionId: "session-1",
      worktreeSession: { worktreeName: "docs" },
    };
    expect(shouldRenderInTranscript(worktreeState, off)).toBe(false);
    expect(shouldRenderInTranscript(worktreeState, on)).toBe(false);
  });

  it("leaves tool results to the tool call that produced them", () => {
    const toolResultOnly: UserConversation = {
      ...createUserConversation("uuid-2"),
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tool-1", content: "ok" }],
      },
    };
    expect(shouldRenderInTranscript(toolResultOnly, off)).toBe(false);
  });

  it("leaves sidechain messages to the task that spawned them", () => {
    const sidechain: UserConversation = { ...createUserConversation("uuid-3"), isSidechain: true };
    expect(shouldRenderInTranscript(sidechain, on)).toBe(false);
  });
});

describe("assistant entries with nothing to draw", () => {
  const assistant = (content: Extract<Conversation, { type: "assistant" }>["message"]["content"]) =>
    ({
      type: "assistant",
      uuid: "assistant-1",
      timestamp: "2024-01-01T00:00:00.000Z",
      isSidechain: false,
      userType: "external",
      cwd: "/tmp",
      sessionId: "session-1",
      version: "1.0.0",
      parentUuid: null,
      message: {
        id: "msg-1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5",
        content,
      },
    }) satisfies Conversation;

  it("drops the blank row an empty thinking block would leave", () => {
    expect(
      shouldRenderInTranscript(assistant([{ type: "thinking", thinking: "", signature: "" }]), {
        showTechnicalDetails: false,
      }),
    ).toBe(false);
  });

  it("keeps anything with text to show", () => {
    expect(
      shouldRenderInTranscript(assistant([{ type: "text", text: "done" }]), {
        showTechnicalDetails: false,
      }),
    ).toBe(true);
  });
});

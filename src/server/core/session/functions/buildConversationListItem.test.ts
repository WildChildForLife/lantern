import { expect, test } from "vitest";
import type { ConversationListItem } from "../../types.ts";
import { CLASSIFIER_MARKER } from "./buildClassificationPrompt.ts";
import {
  buildConversationListItem,
  conversationSearchText,
  firstUserMessageText,
  isInternalSession,
  matchesConversationQuery,
  userMessageText,
} from "./buildConversationListItem.ts";

const item = (overrides: Partial<ConversationListItem> = {}): ConversationListItem => ({
  sessionId: "session",
  projectId: "project",
  source: "claude-code",
  projectName: null,
  projectPath: "/home/me/shop",
  title: "Fix the checkout total",
  firstUserMessage: null,
  messageCount: 3,
  lastModifiedAt: "2026-07-01T10:00:00.000Z",
  modelName: null,
  totalCostUsd: 0,
  costConfidence: "estimated",
  ...overrides,
});

test("maps a database row onto a list item", () => {
  const built = buildConversationListItem({
    sessionId: "abc",
    projectId: "project",
    source: "claude-code",
    projectName: "shop",
    projectPath: "/home/me/shop",
    customTitle: "Fix the checkout total",
    firstUserMessageJson: JSON.stringify({ kind: "text", content: "the total is wrong" }),
    messageCount: 7,
    lastModifiedAt: "2026-07-01T10:00:00.000Z",
    modelName: "claude-sonnet-4-5",
    totalCostUsd: 1.5,
    costConfidence: "estimated",
  });

  expect(built.sessionId).toBe("abc");
  expect(built.title).toBe("Fix the checkout total");
  expect(built.firstUserMessage).toEqual({ kind: "text", content: "the total is wrong" });
  // The number is meaningless without it, so the list item carries both.
  expect(built.costConfidence).toBe("estimated");
});

test("reads the first user message whatever shape it was logged in", () => {
  expect(firstUserMessageText(item({ firstUserMessage: { kind: "text", content: "hello" } }))).toBe(
    "hello",
  );
  expect(
    firstUserMessageText(
      item({ firstUserMessage: { kind: "command", commandName: "/init", commandArgs: "--force" } }),
    ),
  ).toBe("/init --force");
  expect(
    firstUserMessageText(item({ firstUserMessage: { kind: "local-command", stdout: "done" } })),
  ).toBe("done");
  expect(firstUserMessageText(item({ firstUserMessage: null }))).toBe("");
});

test("reads a bare user message without a list item around it", () => {
  expect(userMessageText({ kind: "text", content: "hello" })).toBe("hello");
  expect(userMessageText({ kind: "command", commandName: "/init", commandArgs: "--force" })).toBe(
    "/init --force",
  );
  expect(userMessageText({ kind: "command", commandName: "/init" })).toBe("/init ");
  expect(userMessageText({ kind: "local-command", stdout: "done" })).toBe("done");
  expect(userMessageText(null)).toBe("");
});

test("matches a conversation on its title, project or first message", () => {
  const conversation = item({
    title: "Fix the checkout total",
    projectPath: "/home/me/shop",
    firstUserMessage: { kind: "text", content: "VAT is doubled" },
  });

  expect(matchesConversationQuery(conversation, "checkout")).toBe(true);
  expect(matchesConversationQuery(conversation, "shop")).toBe(true);
  expect(matchesConversationQuery(conversation, "vat")).toBe(true);
  expect(matchesConversationQuery(conversation, "invoice")).toBe(false);
});

test("treats an empty query as matching everything", () => {
  expect(matchesConversationQuery(item(), "")).toBe(true);
  expect(matchesConversationQuery(item(), "   ")).toBe(true);
});

test("searches case insensitively", () => {
  expect(matchesConversationQuery(item({ title: "Fix The Checkout" }), "CHECKOUT")).toBe(true);
  expect(conversationSearchText(item({ title: "MiXeD" }))).toContain("mixed");
});

test("recognises the sessions the classifier created for itself", () => {
  const classifierRun = item({
    title: null,
    firstUserMessage: { kind: "text", content: `${CLASSIFIER_MARKER}\nYou are organising...` },
  });

  expect(isInternalSession(classifierRun)).toBe(true);
});

test("recognises classifier runs from before the marker existed", () => {
  const legacyRun = item({
    title: null,
    firstUserMessage: {
      kind: "text",
      content: "You are organising a personal dashboard of Claude Code conversations. Put every...",
    },
  });

  expect(isInternalSession(legacyRun)).toBe(true);
});

test("leaves a real conversation alone", () => {
  expect(isInternalSession(item({ firstUserMessage: { kind: "text", content: "hello" } }))).toBe(
    false,
  );
});

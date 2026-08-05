import { parsedUserMessageSchema } from "../../claude-code/functions/parseUserMessage.ts";
import type { ConversationListItem } from "../../types.ts";
import { CLASSIFIER_MARKER, LEGACY_CLASSIFIER_MARKERS } from "./buildClassificationPrompt.ts";

const parsedUserMessageOrNullSchema = parsedUserMessageSchema.nullable();

export type ConversationListRow = {
  sessionId: string;
  projectId: string;
  source: string;
  projectName: string | null;
  projectPath: string | null;
  customTitle: string | null;
  firstUserMessageJson: string | null;
  messageCount: number;
  lastModifiedAt: string;
  modelName: string | null;
  totalCostUsd: number;
};

/**
 * Converts a joined sessions+projects DB row into the list item returned by the
 * conversations API. `customTitle` holds Claude Code's own conversation title
 * (a `custom-title` entry when the user renamed it, otherwise the `ai-title`
 * entry Claude writes into the JSONL).
 */
export const buildConversationListItem = (row: ConversationListRow): ConversationListItem => ({
  sessionId: row.sessionId,
  projectId: row.projectId,
  source: row.source,
  projectName: row.projectName,
  projectPath: row.projectPath,
  title: row.customTitle,
  firstUserMessage:
    row.firstUserMessageJson !== null
      ? parsedUserMessageOrNullSchema.parse(JSON.parse(row.firstUserMessageJson))
      : null,
  messageCount: row.messageCount,
  lastModifiedAt: row.lastModifiedAt,
  modelName: row.modelName,
  totalCostUsd: row.totalCostUsd,
});

/**
 * Sessions the viewer created itself by running the topic classifier. They are
 * noise in a list of the user's own conversations.
 */
export const isInternalSession = (item: ConversationListItem): boolean => {
  const text = firstUserMessageText(item).trimStart();
  return (
    text.startsWith(CLASSIFIER_MARKER) ||
    LEGACY_CLASSIFIER_MARKERS.some((marker) => text.startsWith(marker))
  );
};

/** Plain text of the first user message, whatever shape it was logged in. */
export const firstUserMessageText = (item: ConversationListItem): string => {
  const message = item.firstUserMessage;
  if (message === null) return "";
  switch (message.kind) {
    case "command":
      return `${message.commandName} ${message.commandArgs ?? ""}`;
    case "local-command":
      return message.stdout;
    case "text":
      return message.content;
    default:
      message satisfies never;
      return "";
  }
};

/**
 * Text a conversation is matched against when the user filters the list.
 * Kept pure so the filter behaviour is unit testable.
 */
export const conversationSearchText = (item: ConversationListItem): string => {
  return [
    item.title ?? "",
    firstUserMessageText(item),
    item.projectName ?? "",
    item.projectPath ?? "",
  ]
    .join("\n")
    .toLowerCase();
};

export const matchesConversationQuery = (item: ConversationListItem, query: string): boolean => {
  const normalized = query.trim().toLowerCase();
  if (normalized === "") return true;
  return conversationSearchText(item).includes(normalized);
};

import type { Conversation } from "@/lib/conversation-schema";
import {
  getConversationVisibility,
  isMessageEntry,
} from "@/lib/conversation-schema/entryVisibility";
import type { ErrorJsonl } from "@/server/core/types";

export type RenderableConversationRow = {
  conversation: Conversation | ErrorJsonl;
  showTimestamp: boolean;
  rowKey: string;
};

const noTimestampConversationTypes = new Set<Conversation["type"]>([
  "summary",
  "progress",
  "queue-operation",
  "file-history-snapshot",
  "custom-title",
  "ai-title",
  "agent-name",
  "agent-setting",
  "attachment",
  "mode",
  "relocated",
  "worktree-state",
  "file-history-delta",
  "frame-link",
  "atis-latch",
]);

export const getConversationKey = (conversation: Conversation) => {
  if (conversation.type === "user") {
    return `user_${conversation.uuid}`;
  }

  if (conversation.type === "assistant") {
    return `assistant_${conversation.uuid}`;
  }

  if (conversation.type === "system") {
    return `system_${conversation.uuid}`;
  }

  if (conversation.type === "summary") {
    return `summary_${conversation.leafUuid}`;
  }

  if (conversation.type === "file-history-snapshot") {
    return `file-history-snapshot_${conversation.messageId}`;
  }

  if (conversation.type === "queue-operation") {
    return `queue-operation_${conversation.operation}_${conversation.sessionId}_${conversation.timestamp}`;
  }

  if (conversation.type === "progress") {
    return `progress_${conversation.uuid}`;
  }

  if (conversation.type === "custom-title") {
    return `custom-title_${conversation.sessionId}_${conversation.customTitle}`;
  }

  if (conversation.type === "ai-title") {
    return `ai-title_${conversation.sessionId}_${conversation.aiTitle}`;
  }

  if (conversation.type === "agent-name") {
    return `agent-name_${conversation.sessionId}_${conversation.agentName}`;
  }

  if (conversation.type === "agent-setting") {
    return `agent-setting_${conversation.sessionId}_${conversation.agentSetting}`;
  }

  if (conversation.type === "pr-link") {
    return `pr-link_${conversation.sessionId}_${conversation.prNumber}`;
  }

  if (conversation.type === "last-prompt") {
    return `last-prompt_${conversation.sessionId}`;
  }

  if (conversation.type === "permission-mode") {
    return `permission-mode_${conversation.sessionId}_${conversation.permissionMode}`;
  }

  if (conversation.type === "attachment") {
    return `attachment_${conversation.uuid}`;
  }

  if (conversation.type === "mode") {
    return `mode_${conversation.sessionId}_${conversation.mode}`;
  }

  if (conversation.type === "relocated") {
    return `relocated_${conversation.sessionId}_${conversation.relocatedCwd}`;
  }

  if (conversation.type === "worktree-state") {
    return `worktree-state_${conversation.sessionId}`;
  }

  if (conversation.type === "file-history-delta") {
    return `file-history-delta_${conversation.messageId}_${conversation.trackingPath}`;
  }

  if (conversation.type === "frame-link") {
    return `frame-link_${conversation.sessionId}_${conversation.path}`;
  }

  if (conversation.type === "atis-latch") {
    return `atis-latch_${conversation.sessionId}`;
  }

  conversation satisfies never;
  throw new Error("Unknown conversation type");
};

/**
 * A user entry whose whole content is tool results. Claude Code files tool
 * output under the user role, but nobody typed it - it belongs to the tool
 * call above, which already draws it.
 */
const isOnlyToolResult = (conversation: Conversation): boolean => {
  if (conversation.type !== "user") {
    return false;
  }

  const content = conversation.message.content;
  if (typeof content === "string") {
    return false;
  }

  return content.every((item) => typeof item !== "string" && item.type === "tool_result");
};

/**
 * An assistant entry with nothing left to draw once tool results and empty
 * thinking blocks are set aside. Rendering it leaves a blank row, which reads
 * as a gap in the conversation rather than the non-event it is.
 */
const hasNothingToDraw = (conversation: Conversation): boolean => {
  if (conversation.type !== "assistant") {
    return false;
  }

  return conversation.message.content.every(
    (content) =>
      content.type === "tool_result" || (content.type === "thinking" && content.thinking === ""),
  );
};

/**
 * Whether an entry earns a row of its own in the transcript.
 *
 * Parse failures always show - a line Lantern could not read is the one thing
 * a reader most needs to know about.
 */
export const shouldRenderInTranscript = (
  conversation: Conversation | ErrorJsonl,
  options: { showTechnicalDetails: boolean },
): boolean => {
  if (conversation.type === "x-error") {
    return true;
  }

  const visibility = getConversationVisibility(conversation);
  if (visibility === "internal") {
    return false;
  }

  if (visibility === "technical" && !options.showTechnicalDetails) {
    return false;
  }

  // Sidechains are drawn inside the tool call that spawned them.
  if (isMessageEntry(conversation) && conversation.isSidechain) {
    return false;
  }

  return !isOnlyToolResult(conversation) && !hasNothingToDraw(conversation);
};

export const buildRenderableConversationRows = (
  conversations: readonly (Conversation | ErrorJsonl)[],
  shouldRenderConversation: (conversation: Conversation | ErrorJsonl) => boolean,
): RenderableConversationRow[] => {
  const rows: RenderableConversationRow[] = [];
  const keyOccurrenceMap = new Map<string, number>();

  const createUniqueRowKey = (baseKey: string): string => {
    const occurrence = keyOccurrenceMap.get(baseKey) ?? 0;
    keyOccurrenceMap.set(baseKey, occurrence + 1);
    return occurrence === 0 ? baseKey : `${baseKey}_${occurrence}`;
  };

  for (const conversation of conversations) {
    if (conversation.type === "x-error") {
      rows.push({
        conversation,
        showTimestamp: false,
        rowKey: createUniqueRowKey(`error_${conversation.lineNumber}`),
      });
      continue;
    }

    if (!shouldRenderConversation(conversation)) {
      continue;
    }

    rows.push({
      conversation,
      showTimestamp: !noTimestampConversationTypes.has(conversation.type),
      rowKey: createUniqueRowKey(getConversationKey(conversation)),
    });
  }

  return rows;
};

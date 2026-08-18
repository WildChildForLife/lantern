import type { Conversation, SidechainConversation } from "./index.ts";

/**
 * How much of a session a reader is asking for.
 *
 * A JSONL session log is not a transcript: for every line the person actually
 * saw, Claude Code writes several more that only exist so the CLI can resume,
 * rewind and re-title the session. Rendering all of them turns a readable
 * conversation into a wall of collapsibles, so each entry declares which
 * audience it belongs to.
 *
 * - `transcript`: the person saw this, or something standing in for it.
 * - `technical`: real plumbing a curious reader may want - hook summaries,
 *   queued prompts, file backups. Hidden until asked for.
 * - `internal`: bookkeeping with nothing to show. Never rendered, at any
 *   setting; the raw JSONL remains the place to look.
 */
export type ConversationVisibility = "transcript" | "technical" | "internal";

/**
 * System entries cover both ends of the range: a compaction notice or an API
 * error is part of what happened, while turn timings and hook bookkeeping are
 * plumbing. Turn duration in particular is already drawn under the assistant
 * message it belongs to, so repeating it as its own row is pure duplication.
 */
const technicalSystemSubtypes = new Set(["turn_duration", "stop_hook_summary"]);

export const getConversationVisibility = (conversation: Conversation): ConversationVisibility => {
  switch (conversation.type) {
    case "user":
    case "assistant":
    case "summary":
      return "transcript";

    case "system":
      return conversation.subtype !== undefined && technicalSystemSubtypes.has(conversation.subtype)
        ? "technical"
        : "transcript";

    case "queue-operation":
    case "file-history-snapshot":
      return "technical";

    // Bookkeeping: session titles, agent names, permission and input modes,
    // worktree moves, per-file backups, published-artifact links, and the
    // context attachments the CLI injects but never shows.
    case "attachment":
    case "progress":
    case "custom-title":
    case "ai-title":
    case "agent-name":
    case "agent-setting":
    case "pr-link":
    case "last-prompt":
    case "permission-mode":
    case "mode":
    case "relocated":
    case "worktree-state":
    case "file-history-delta":
    case "frame-link":
      return "internal";

    default:
      conversation satisfies never;
      return "internal";
  }
};

/**
 * The entries that carry a message identity - `uuid`, `parentUuid`,
 * `isSidechain`. Everything else in the union is a bare metadata record.
 *
 * An allowlist on purpose: the previous long list of "not this type, not that
 * type" quietly broke every time Claude Code added an entry kind.
 */
export const isMessageEntry = (
  conversation: Conversation,
): conversation is SidechainConversation => {
  return (
    conversation.type === "user" ||
    conversation.type === "assistant" ||
    conversation.type === "system"
  );
};

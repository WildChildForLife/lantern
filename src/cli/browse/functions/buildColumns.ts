import { resolveSessionTitle, toConciseTitle } from "../../../lib/session/sessionTitle.ts";
import type { ConversationListEntry, TopicGroup } from "../../../server/core/types.ts";

/** A conversation with the one string the board actually draws. */
export type BoardRow = ConversationListEntry & {
  displayTitle: string;
};

export type BoardColumn = {
  topic: TopicGroup;
  rows: BoardRow[];
};

/** Long enough that truncation is the column's job, not this function's. */
const TITLE_LIMIT = 120;

const toBoardRow = (conversation: ConversationListEntry): BoardRow => ({
  ...conversation,
  displayTitle: toConciseTitle(
    resolveSessionTitle(conversation.title, conversation.firstUserMessage, conversation.sessionId),
    TITLE_LIMIT,
  ),
});

const matches = (row: BoardRow, needle: string): boolean =>
  row.displayTitle.toLowerCase().includes(needle) ||
  (row.projectName?.toLowerCase().includes(needle) ?? false) ||
  (row.projectPath?.toLowerCase().includes(needle) ?? false);

/**
 * Turns the flat conversation list into the board's columns.
 *
 * Grouping itself is not repeated here: every conversation arrives already
 * carrying the topic the server clustered it into, so this only partitions,
 * orders and filters — the same job the web board's render does.
 *
 * Filtering deliberately works two ways. Naming a topic keeps all of its
 * conversations, so `/network` reads as "show me that column"; anything else
 * narrows to the conversations that match, so `/refund` finds one row wherever
 * it lives.
 */
export const buildColumns = ({
  topics,
  conversations,
  filter,
}: {
  topics: TopicGroup[];
  conversations: ConversationListEntry[];
  filter: string;
}): BoardColumn[] => {
  const needle = filter.trim().toLowerCase();

  const rowsByTopic = new Map<string, BoardRow[]>();
  for (const conversation of conversations) {
    const rows = rowsByTopic.get(conversation.topic.id) ?? [];
    rows.push(toBoardRow(conversation));
    rowsByTopic.set(conversation.topic.id, rows);
  }

  // Taken before filtering so the column order does not jump around as the
  // user types.
  const lastActivityByTopic = new Map<string, number>();
  for (const conversation of conversations) {
    const at = new Date(conversation.lastModifiedAt).getTime();
    const current = lastActivityByTopic.get(conversation.topic.id);
    if (current === undefined || at > current) {
      lastActivityByTopic.set(conversation.topic.id, at);
    }
  }

  return topics
    .map((topic) => {
      const rows = (rowsByTopic.get(topic.id) ?? []).toSorted(
        (left, right) =>
          new Date(right.lastModifiedAt).getTime() - new Date(left.lastModifiedAt).getTime(),
      );

      if (needle === "" || topic.label.toLowerCase().includes(needle)) {
        return { topic, rows };
      }

      return { topic, rows: rows.filter((row) => matches(row, needle)) };
    })
    .filter((column) => column.rows.length > 0)
    .toSorted(
      (left, right) =>
        (lastActivityByTopic.get(right.topic.id) ?? 0) -
        (lastActivityByTopic.get(left.topic.id) ?? 0),
    );
};

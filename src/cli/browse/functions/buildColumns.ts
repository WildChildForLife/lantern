import { resolveSessionTitle, toConciseTitle } from "../../../lib/session/sessionTitle.ts";
import type { ConversationListEntry, TopicGroup } from "../../../server/core/types.ts";
import { mergeSpans, type MatchSpan, parseQuery, type Query, scoreMatch } from "./searchMatch.ts";

/**
 * A conversation with the one string the board actually draws.
 *
 * The title and its spans are nested together rather than sitting as two fields
 * beside `ConversationListEntry`'s own `title`. The spans index `display.title`
 * and nothing else — they are offsets into a string that has already been
 * shortened — and as a loose `titleSpans` they could be reached for a keystroke
 * away from `row.title`, which would highlight the wrong characters on every row
 * the shortening touched. Nested, you cannot take the spans without taking the
 * string they belong to.
 */
export type BoardRow = ConversationListEntry & {
  display: {
    title: string;
    /** Where the search matched, in code points. Empty when nothing was searched for. */
    spans: MatchSpan[];
  };
};

export type BoardColumn = {
  topic: TopicGroup;
  rows: BoardRow[];
};

/** Long enough that truncation is the column's job, not this function's. */
const TITLE_LIMIT = 120;

const toBoardRow = (conversation: ConversationListEntry): BoardRow => ({
  ...conversation,
  display: {
    title: toConciseTitle(
      resolveSessionTitle(
        conversation.title,
        conversation.firstUserMessage,
        conversation.sessionId,
      ),
      TITLE_LIMIT,
    ),
    spans: [],
  },
});

/**
 * How much a hit in each field counts towards the row's place in the results.
 *
 * A conversation whose title is what was typed is the one being looked for; the
 * same characters found in the path every conversation in the project shares are
 * barely evidence at all. The weights bias the order rather than fixing it — a
 * title matched only loosely can still fall below a path matched squarely.
 *
 * The topic is not among them on purpose. It is matched once per column, in one
 * piece, and scoring it per row as well let a scattered match on the heading
 * quietly keep every row underneath it — which is the column-wide rule again,
 * without the deliberate spelling it asks for.
 */
const FIELD_WEIGHT = {
  title: 3,
  projectName: 2,
  projectPath: 1,
} as const;

type Scored = { row: BoardRow; score: number };

/**
 * Scores one conversation against every term, or rejects it.
 *
 * Every term has to find some field to match — not a different one each, though
 * it may work out that way: `refund lantern` can take the title with one word and
 * the project with the other. A term that matches nothing takes the whole row out.
 */
const scoreRow = (row: BoardRow, query: Query): Scored | null => {
  const spans: MatchSpan[] = [];
  let total = 0;

  for (const term of query.terms) {
    const title = scoreMatch(row.display.title, term, query.caseSensitive);
    const fields = [
      { match: title, weight: FIELD_WEIGHT.title },
      {
        match: scoreMatch(row.projectName ?? "", term, query.caseSensitive),
        weight: FIELD_WEIGHT.projectName,
      },
      {
        match: scoreMatch(row.projectPath ?? "", term, query.caseSensitive),
        weight: FIELD_WEIGHT.projectPath,
      },
    ];

    const best = fields.reduce(
      (highest: number | null, field) =>
        field.match === null
          ? highest
          : Math.max(highest ?? Number.NEGATIVE_INFINITY, field.match.score * field.weight),
      null,
    );

    if (best === null) {
      return null;
    }

    total += best;
    // Highlighted whether or not the title was this term's best field: a match
    // the row is showing is a match worth pointing at.
    if (title !== null) {
      spans.push(...title.spans);
    }
  }

  return { row: { ...row, display: { ...row.display, spans: mergeSpans(spans) } }, score: total };
};

/** The one place the topic heading itself is matched, and always in one piece. */
const topicMatches = (label: string, query: Query): boolean => {
  const haystack = query.caseSensitive ? label : label.toLowerCase();

  return query.terms.every((term) =>
    haystack.includes(query.caseSensitive ? term : term.toLowerCase()),
  );
};

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
 *
 * A search reorders as well as narrows: the closest match to what was typed goes
 * to the top of its column, and recency only settles ties. Naming a topic does
 * not — that column was asked for whole, and it is still a column of history.
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
  const query = parseQuery(filter);

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

      if (query.terms.length === 0 || topicMatches(topic.label, query)) {
        return { topic, rows };
      }

      const scored = rows
        .map((row) => scoreRow(row, query))
        .filter((match) => match !== null)
        // Recency is the tie-break rather than the order, so a column of equally
        // good matches still reads newest first.
        .toSorted((left, right) => right.score - left.score);

      return { topic, rows: scored.map((match) => match.row) };
    })
    .filter((column) => column.rows.length > 0)
    .toSorted(
      (left, right) =>
        (lastActivityByTopic.get(right.topic.id) ?? 0) -
        (lastActivityByTopic.get(left.topic.id) ?? 0),
    );
};

import { parsedUserMessageSchema } from "../../claude-code/functions/parseUserMessage.ts";
import {
  CLASSIFIER_MARKER,
  type ClassificationCandidate,
  LEGACY_CLASSIFIER_MARKERS,
} from "./buildClassificationPrompt.ts";
import { userMessageText } from "./buildConversationListItem.ts";

/**
 * Turning a session row into something the classifier can be asked about.
 *
 * Deliberately row-shaped rather than taking a `ConversationListItem`: the
 * classifier needs four columns, and building a full list item for every
 * session in the database is what made counting candidates expensive.
 */

const parsedUserMessageOrNullSchema = parsedUserMessageSchema.nullable();

/** How much of a first message is worth showing the classifier. */
const MAX_TEXT_LENGTH = 160;

export type ClassificationCandidateRow = {
  readonly sessionId: string;
  readonly projectPath: string | null;
  readonly customTitle: string | null;
  readonly firstUserMessageJson: string | null;
};

/**
 * A malformed row must not take the whole pass down with it. Before this was a
 * `try`, one unparseable `first_user_message_json` threw out of the candidate
 * scan and turned the count endpoint into a 500.
 */
const parseFirstUserMessage = (json: string | null) => {
  if (json === null) return null;
  try {
    return parsedUserMessageOrNullSchema.parse(JSON.parse(json));
  } catch {
    return null;
  }
};

/** What the classifier is shown, or "" when there is nothing to show it. */
export const classificationCandidateText = (row: ClassificationCandidateRow): string => {
  const title = row.customTitle?.trim() ?? "";
  if (title !== "") return title;

  return userMessageText(parseFirstUserMessage(row.firstUserMessageJson))
    .slice(0, MAX_TEXT_LENGTH)
    .trim();
};

/**
 * A run the classifier logged for itself. Classifying those would have it name
 * topics for its own prompts.
 *
 * The marker check needs the message parsed, but a substring test on the raw
 * JSON rules out almost every row without parsing anything - and it cannot rule
 * out a row that would have matched, because the precise test is `startsWith`.
 */
export const isClassifierOwnRow = (row: ClassificationCandidateRow): boolean => {
  const json = row.firstUserMessageJson;
  if (json === null) return false;

  const mightMention =
    json.includes(CLASSIFIER_MARKER) ||
    LEGACY_CLASSIFIER_MARKERS.some((marker) => json.includes(marker));
  if (!mightMention) return false;

  const text = userMessageText(parseFirstUserMessage(json)).trimStart();
  return (
    text.startsWith(CLASSIFIER_MARKER) ||
    LEGACY_CLASSIFIER_MARKERS.some((marker) => text.startsWith(marker))
  );
};

/** null when the row is one of the classifier's own runs, or has no text. */
export const toClassificationCandidate = (
  row: ClassificationCandidateRow,
): ClassificationCandidate | null => {
  if (isClassifierOwnRow(row)) return null;

  const text = classificationCandidateText(row);
  if (text === "") return null;

  return { sessionId: row.sessionId, text, projectPath: row.projectPath };
};

/**
 * The candidates one pass will actually ask about, plus how many the scope
 * resolved to before the cap. The difference is what the user is told is left
 * over, so a capped pass reads as deferred rather than as finished.
 */
export const selectPassCandidates = (
  rows: readonly ClassificationCandidateRow[],
  max: number,
): { readonly queued: readonly ClassificationCandidate[]; readonly requested: number } => {
  const candidates: ClassificationCandidate[] = [];
  for (const row of rows) {
    const candidate = toClassificationCandidate(row);
    if (candidate !== null) candidates.push(candidate);
  }

  return { queued: candidates.slice(0, max), requested: candidates.length };
};

import { z } from "zod";
import { TOPIC_ICON_NAMES } from "./groupConversationsByTopic.ts";

/**
 * Every classifier prompt starts with this line. The CLI logs its own run as a
 * session under ~/.claude/projects, so without a marker the dashboard fills up
 * with the classifier talking to itself.
 */
export const CLASSIFIER_MARKER = "[ccv-topic-classifier]";

/**
 * Prompt openings used before the marker existed. Kept so the runs that already
 * landed in the log stay hidden instead of posing as conversations forever.
 */
export const LEGACY_CLASSIFIER_MARKERS = [
  "You are organising a personal dashboard of Claude Code conversations.",
];

/** One conversation handed to the classifier. */
export type ClassificationCandidate = {
  sessionId: string;
  text: string;
  projectPath: string | null;
};

export const classificationResultSchema = z.array(
  z.object({
    n: z.number().int().min(1),
    topic: z.string().min(1).max(40),
    icon: z.string().min(1).max(32),
  }),
);

export type ClassificationResult = z.infer<typeof classificationResultSchema>;

/**
 * Asks Claude to file each conversation under a topic. Existing topics are
 * listed first and reuse is pushed hard: without that, every batch invents its
 * own near-duplicate wording ("Tizen app", "Tizen IPTV", "Samsung TV app").
 */
export const buildClassificationPrompt = (
  candidates: readonly ClassificationCandidate[],
  existingTopics: readonly string[],
): string => {
  const lines = candidates.map(
    (candidate, index) =>
      `${index + 1}. ${candidate.text.replace(/\s+/g, " ").slice(0, 160)}${
        candidate.projectPath === null ? "" : `  [folder: ${candidate.projectPath}]`
      }`,
  );

  const existing =
    existingTopics.length === 0
      ? "(none yet - you are naming the first topics)"
      : existingTopics.join(", ");

  return [
    CLASSIFIER_MARKER,
    "You are organising a personal dashboard of Claude Code conversations.",
    "Put every conversation below under a topic: the project, application or subject it is about.",
    "",
    `Existing topics, reuse one whenever it fits: ${existing}`,
    `Allowed icons: ${TOPIC_ICON_NAMES.join(", ")}`,
    "",
    "Rules:",
    "- Topic names: 1 to 3 words, Title Case, no trailing punctuation.",
    "- Strongly prefer an existing topic over a new one; only invent a topic when nothing fits.",
    "- Group by subject, not by folder. The folder is a hint, not the answer.",
    '- A topic names a thing: a product, app, repository, machine or domain ("Tizen IPTV", "Home Network", "Portfolio Site").',
    '- Never name an activity or a state ("Testing", "Exploration", "Closing", "Debugging"), a person, or "Misc"/"Other".',
    "- When a conversation is a one-off, still file it under the system it touches rather than inventing a topic for it.",
    "- Use the same icon every time for the same topic.",
    "",
    "Conversations:",
    ...lines,
    "",
    'Reply with JSON only, no prose and no code fences: [{"n":1,"topic":"...","icon":"..."}, ...]',
    "One object per conversation, same numbering.",
  ].join("\n");
};

/**
 * The envelope `claude -p --output-format json` prints: the answer plus what the
 * call cost, which is what lets a run report its own spend.
 */
export const cliEnvelopeSchema = z.object({
  result: z.string(),
  total_cost_usd: z.number().optional(),
});

/** Pulls the JSON array out of the CLI's answer, fences and chatter included. */
export const parseClassificationResponse = (output: string): ClassificationResult | null => {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;

  try {
    const parsed = classificationResultSchema.safeParse(JSON.parse(output.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

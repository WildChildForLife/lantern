import { z } from "zod";
import { parsedUserMessageSchema } from "../claude-code/functions/parseUserMessage.ts";

/**
 * Lightweight session row used by the cross-project conversation list.
 * Intentionally avoids the full session meta (cost breakdown, PR links, ...)
 * so listing every session across every project stays a single DB query.
 */
export const conversationListItemSchema = z.object({
  sessionId: z.string(),
  projectId: z.string(),
  /** Which agent CLI recorded this conversation. */
  source: z.string(),
  projectName: z.string().nullable(),
  projectPath: z.string().nullable(),
  title: z.string().nullable(),
  firstUserMessage: parsedUserMessageSchema.nullable(),
  messageCount: z.number(),
  lastModifiedAt: z.string(),
  modelName: z.string().nullable(),
  totalCostUsd: z.number(),
  /** Never render totalCostUsd without it — see formatCost. */
  costConfidence: z.string(),
});

/**
 * A topic is a cluster of conversations that talk about the same thing,
 * derived locally from the conversation titles - see groupConversationsByTopic.
 */
export const topicRefSchema = z.object({
  id: z.string(),
  label: z.string(),
  icon: z.string(),
});

export const topicGroupSchema = topicRefSchema.extend({
  count: z.number(),
});

/** A conversation list row plus the topic it was clustered into. */
export const conversationListEntrySchema = conversationListItemSchema.extend({
  topic: topicRefSchema,
});

export const sessionMetaSchema = z.object({
  messageCount: z.number(),
  firstUserMessage: parsedUserMessageSchema.nullable(),
  customTitle: z.string().nullable(),
  cost: z.object({
    totalUsd: z.number(),
    /** Whether totalUsd is reported, estimated, or not knowable. */
    confidence: z.enum(["reported", "estimated", "unknown"]),
    breakdown: z.object({
      inputTokensUsd: z.number(),
      outputTokensUsd: z.number(),
      cacheCreationUsd: z.number(),
      cacheReadUsd: z.number(),
    }),
    tokenUsage: z.object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      cacheCreationTokens: z.number(),
      cacheReadTokens: z.number(),
    }),
  }),
  modelName: z.string().nullable(),
  prLinks: z.array(
    z.object({
      prNumber: z.number(),
      prUrl: z.string(),
      prRepository: z.string(),
    }),
  ),
});

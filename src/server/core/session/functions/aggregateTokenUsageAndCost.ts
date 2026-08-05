import { parseJsonl } from "../../claude-code/functions/parseJsonl.ts";
import {
  type CostConfidence,
  calculateTokenCost,
  type TokenUsage,
} from "./calculateSessionCost.ts";

/**
 * Aggregates token usage and cost from multiple file contents.
 *
 * This function processes conversation logs from one or more files (main session + agent sessions),
 * extracts token usage from assistant messages, and calculates the total cost across all files.
 *
 * @param fileContents - Array of JSONL file contents to process
 * @returns Aggregated token usage, total cost, and the last model name used
 *
 * @example
 * ```typescript
 * const result = aggregateTokenUsageAndCost([
 *   mainSessionContent,
 *   agentSession1Content,
 *   agentSession2Content
 * ]);
 *
 * console.log(result.totalCost.totalUsd); // Total cost across all sessions
 * console.log(result.totalUsage.input_tokens); // Total input tokens
 * ```
 */
export const aggregateTokenUsageAndCost = (
  fileContents: string[],
): {
  totalUsage: TokenUsage;
  totalCost: ReturnType<typeof calculateTokenCost>;
  modelName: string | null;
} => {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheCreationTokens = 0;
  let totalCacheReadTokens = 0;
  let totalInputTokensUsd = 0;
  let totalOutputTokensUsd = 0;
  let totalCacheCreationUsd = 0;
  let totalCacheReadUsd = 0;
  // No default: a session with no assistant message has no model, and claiming
  // one would put a price on it.
  let lastModelName: string | null = null;
  let unpricedMessages = 0;

  // Process each file content
  for (const content of fileContents) {
    const conversations = parseJsonl(content);

    for (const conversation of conversations) {
      if (conversation.type === "assistant") {
        const messageUsage = conversation.message.usage;
        const entryUsage = conversation.usage;
        const inputTokens = messageUsage?.input_tokens ?? entryUsage?.input_tokens ?? 0;
        const outputTokens = messageUsage?.output_tokens ?? entryUsage?.output_tokens ?? 0;
        const cacheCreationInputTokens = messageUsage?.cache_creation_input_tokens ?? 0;
        const cacheReadInputTokens = messageUsage?.cache_read_input_tokens ?? 0;
        const modelName = conversation.message.model;

        // Calculate cost for this specific message
        const messageCost = calculateTokenCost(
          {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_creation_input_tokens: cacheCreationInputTokens,
            cache_read_input_tokens: cacheReadInputTokens,
          },
          modelName,
        );

        // Accumulate token counts
        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;
        totalCacheCreationTokens += cacheCreationInputTokens;
        totalCacheReadTokens += cacheReadInputTokens;

        // Accumulate costs
        totalInputTokensUsd += messageCost.breakdown.inputTokensUsd;
        totalOutputTokensUsd += messageCost.breakdown.outputTokensUsd;
        totalCacheCreationUsd += messageCost.breakdown.cacheCreationUsd;
        totalCacheReadUsd += messageCost.breakdown.cacheReadUsd;

        if (messageCost.confidence === "unknown") {
          unpricedMessages += 1;
        }

        // Track the latest model name
        lastModelName = modelName;
      }
    }
  }

  // One unpriced message makes the whole total incomplete, so the session's
  // cost is reported as unknown rather than as a smaller-than-real number.
  // No assistant message means no model, and calculateTokenCost answers
  // "unknown" for that same state — the two must not disagree.
  const confidence: CostConfidence =
    unpricedMessages > 0 || lastModelName === null ? "unknown" : "estimated";

  const totalCost: ReturnType<typeof calculateTokenCost> = {
    confidence,
    totalUsd:
      totalInputTokensUsd + totalOutputTokensUsd + totalCacheCreationUsd + totalCacheReadUsd,
    breakdown: {
      inputTokensUsd: totalInputTokensUsd,
      outputTokensUsd: totalOutputTokensUsd,
      cacheCreationUsd: totalCacheCreationUsd,
      cacheReadUsd: totalCacheReadUsd,
    },
    tokenUsage: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cacheCreationTokens: totalCacheCreationTokens,
      cacheReadTokens: totalCacheReadTokens,
    },
  };

  const aggregatedUsage: TokenUsage = {
    input_tokens: totalInputTokens,
    output_tokens: totalOutputTokens,
    cache_creation_input_tokens: totalCacheCreationTokens,
    cache_read_input_tokens: totalCacheReadTokens,
  };

  return {
    totalUsage: aggregatedUsage,
    totalCost,
    modelName: lastModelName,
  };
};

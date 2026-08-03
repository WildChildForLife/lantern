import { resolvePricing } from "../constants/pricing/index.ts";

/**
 * Token usage information extracted from assistant messages
 */
export type TokenUsage = {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_input_tokens: number | undefined;
  readonly cache_read_input_tokens: number | undefined;
};

/**
 * Cost breakdown by token type in USD
 */
export type CostBreakdown = {
  readonly inputTokensUsd: number;
  readonly outputTokensUsd: number;
  readonly cacheCreationUsd: number;
  readonly cacheReadUsd: number;
};

/**
 * Token usage summary
 */
export type TokenUsageSummary = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
};

/**
 * How much the figure can be trusted.
 *
 * - `reported` — the source stated the cost itself.
 * - `estimated` — derived from token counts and a known price table.
 * - `unknown` — the model has no price here; the total is not a number to show.
 */
export type CostConfidence = "reported" | "estimated" | "unknown";

/**
 * Cost calculation result
 */
export type CostCalculationResult = {
  readonly totalUsd: number;
  readonly breakdown: CostBreakdown;
  readonly tokenUsage: TokenUsageSummary;
  readonly confidence: CostConfidence;
};

const emptyBreakdown: CostBreakdown = {
  inputTokensUsd: 0,
  outputTokensUsd: 0,
  cacheCreationUsd: 0,
  cacheReadUsd: 0,
};

const summarizeUsage = (usage: TokenUsage): TokenUsageSummary => ({
  inputTokens: usage.input_tokens,
  outputTokens: usage.output_tokens,
  cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
  cacheReadTokens: usage.cache_read_input_tokens ?? 0,
});

/**
 * Costs token usage against the price table for the model that produced it.
 *
 * A model with no known price yields zeros and `unknown` confidence rather than
 * a plausible number: token counts are still recorded, but the money is not
 * something this build can claim to know.
 */
export const calculateTokenCost = (
  usage: TokenUsage,
  modelName: string | null,
): CostCalculationResult => {
  const resolved = resolvePricing(modelName);

  if (resolved === null) {
    return {
      totalUsd: 0,
      breakdown: emptyBreakdown,
      tokenUsage: summarizeUsage(usage),
      confidence: "unknown",
    };
  }

  const { pricing } = resolved;

  const inputTokensUsd = (usage.input_tokens / 1_000_000) * pricing.input;
  const outputTokensUsd = (usage.output_tokens / 1_000_000) * pricing.output;
  const cacheCreationUsd =
    ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) * pricing.cache_creation;
  const cacheReadUsd = ((usage.cache_read_input_tokens ?? 0) / 1_000_000) * pricing.cache_read;

  return {
    totalUsd: inputTokensUsd + outputTokensUsd + cacheCreationUsd + cacheReadUsd,
    breakdown: {
      inputTokensUsd,
      outputTokensUsd,
      cacheCreationUsd,
      cacheReadUsd,
    },
    tokenUsage: summarizeUsage(usage),
    confidence: "estimated",
  };
};

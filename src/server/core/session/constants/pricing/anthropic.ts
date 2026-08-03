/**
 * Anthropic Claude API Pricing Information
 * Last updated: 2026-01-08
 *
 * Prices are in USD per million tokens (MTok)
 * Source: https://claude.com/pricing
 */

export type AnthropicModelName =
  | "claude-opus-4.5"
  | "claude-opus-4.1"
  | "claude-sonnet-4.5"
  | "claude-3.5-sonnet"
  | "claude-haiku-4.5"
  | "claude-3-opus"
  | "claude-3-haiku";

import type { ModelPricing } from "./index.ts";

/**
 * Pricing per million tokens (MTok) in USD
 *
 * Note: Claude Sonnet 4.5 has tiered pricing based on prompt length:
 * - ≤200K tokens: $3/$15 (standard tier, used here)
 * - >200K tokens: $6/$22.50 (extended context tier, not implemented)
 * This implementation uses standard tier pricing as the default approximation
 * since prompt length is not tracked at pricing calculation time.
 */
export const ANTHROPIC_MODEL_PRICING: Record<AnthropicModelName, ModelPricing> = {
  "claude-opus-4.5": {
    input: 5.0,
    output: 25.0,
    cache_creation: 6.25,
    cache_read: 0.5,
  },
  "claude-opus-4.1": {
    input: 15.0,
    output: 75.0,
    cache_creation: 18.75,
    cache_read: 1.5,
  },
  "claude-sonnet-4.5": {
    input: 3.0,
    output: 15.0,
    cache_creation: 3.75,
    cache_read: 0.3,
  },
  "claude-3.5-sonnet": {
    input: 3.0,
    output: 15.0,
    cache_creation: 3.75,
    cache_read: 0.3,
  },
  "claude-haiku-4.5": {
    input: 1.0,
    output: 5.0,
    cache_creation: 1.25,
    cache_read: 0.1,
  },
  "claude-3-opus": {
    input: 15.0,
    output: 75.0,
    cache_creation: 18.75,
    cache_read: 1.5,
  },
  "claude-3-haiku": {
    input: 0.25,
    output: 1.25,
    cache_creation: 0.3,
    cache_read: 0.03,
  },
} as const;

/**
 * Maps an API model id onto a priced model, or null when this build has never
 * heard of it — a new Claude release, or another provider's model entirely.
 *
 * Returning null is the point: the previous version answered "claude-3.5-sonnet"
 * for every unrecognised name, so an unknown model was silently billed at Sonnet
 * rates and shown as a fact.
 */
export const normalizeAnthropicModelName = (modelName: string): AnthropicModelName | null => {
  const normalized = modelName.toLowerCase();

  if (normalized.includes("opus-4-5") || normalized.includes("opus-4.5")) {
    return "claude-opus-4.5";
  }
  if (normalized.includes("opus-4-1") || normalized.includes("opus-4.1")) {
    return "claude-opus-4.1";
  }
  if (normalized.includes("sonnet-4-5") || normalized.includes("sonnet-4.5")) {
    return "claude-sonnet-4.5";
  }
  if (normalized.includes("haiku-4-5") || normalized.includes("haiku-4.5")) {
    return "claude-haiku-4.5";
  }
  if (
    normalized.includes("sonnet-4") ||
    normalized.includes("3-5-sonnet") ||
    normalized.includes("3.5-sonnet")
  ) {
    return "claude-3.5-sonnet";
  }
  if (normalized.includes("3-opus") || normalized.includes("opus-20")) {
    return "claude-3-opus";
  }
  if (normalized.includes("3-haiku") || normalized.includes("haiku-20")) {
    return "claude-3-haiku";
  }

  return null;
};

import {
  ANTHROPIC_MODEL_PRICING,
  type AnthropicModelName,
  normalizeAnthropicModelName,
} from "./anthropic.ts";

/** Who charged for the tokens. Each provider prices its own models. */
export type PricingProvider = "anthropic";

export type ModelPricing = {
  readonly input: number;
  readonly output: number;
  readonly cache_creation: number;
  readonly cache_read: number;
};

export type ResolvedPricing = {
  readonly provider: PricingProvider;
  readonly model: AnthropicModelName;
  readonly pricing: ModelPricing;
};

/**
 * Looks up what a model costs, or reports that Lantern does not know.
 *
 * Only Anthropic prices are carried. Sessions from other CLIs are recorded with
 * unknown cost rather than guessed at: a stale or invented price table is worse
 * than an honest blank, because a number renders as fact.
 */
export const resolvePricing = (modelName: string | null): ResolvedPricing | null => {
  if (modelName === null) {
    return null;
  }

  const model = normalizeAnthropicModelName(modelName);
  if (model === null) {
    return null;
  }

  return { provider: "anthropic", model, pricing: ANTHROPIC_MODEL_PRICING[model] };
};

export type { AnthropicModelName } from "./anthropic.ts";

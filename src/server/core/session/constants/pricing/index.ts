import {
  ANTHROPIC_MODEL_PRICING,
  type ModelPricing,
  normalizeAnthropicModelName,
} from "./anthropic.ts";

/**
 * Looks up what a model costs, or reports that Lantern does not know.
 *
 * Only Anthropic prices are carried. Sessions from other CLIs are recorded with
 * unknown cost rather than guessed at: a stale or invented price table is worse
 * than an honest blank, because a number renders as fact.
 */
export const resolvePricing = (modelName: string | null): ModelPricing | null => {
  if (modelName === null) {
    return null;
  }

  const model = normalizeAnthropicModelName(modelName);

  return model === null ? null : ANTHROPIC_MODEL_PRICING[model];
};

export type { ModelPricing } from "./anthropic.ts";

export type CostConfidence = "reported" | "estimated" | "unknown";

/** Shown instead of a number when the model behind a session has no price here. */
export const UNKNOWN_COST_PLACEHOLDER = "—";

/**
 * Renders a session's cost honestly.
 *
 * An unpriced session must not read as free: `$0.00` is a claim, and a wrong
 * one. It shows an em dash instead. An estimate derived from token counts is
 * prefixed with `~`, so a figure Lantern computed is never mistaken for one the
 * provider billed.
 */
export const formatCost = (
  totalUsd: number,
  // Widened to string deliberately: the value crosses the wire as JSON, and an
  // unrecognised one must fall through to the placeholder rather than to a
  // number.
  confidence: string,
  options?: { readonly fractionDigits?: number },
): string => {
  if (confidence !== "estimated" && confidence !== "reported") {
    return UNKNOWN_COST_PLACEHOLDER;
  }

  const amount = `$${totalUsd.toFixed(options?.fractionDigits ?? 2)}`;

  return confidence === "estimated" ? `~${amount}` : amount;
};

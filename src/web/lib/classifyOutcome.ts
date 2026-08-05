import type { ClassifyResult } from "@/server/core/session/schema";

/**
 * What a classification pass amounted to, decided before any wording is chosen.
 *
 * Split out so the rule "when do we say nothing needed doing" is unit tested
 * without a translation catalogue in the way — that claim was wrong before, and
 * a pass that answered but matched nothing reported itself as already sorted.
 */
export type ClassifyOutcome =
  | { readonly kind: "stopped-early"; readonly classified: number; readonly remaining: number }
  | { readonly kind: "nothing-to-do" }
  | {
      readonly kind: "sorted";
      readonly classified: number;
      readonly costUsd: number;
      /** Left for the next pass by the per-pass cap. */
      readonly leftOver: number;
    };

export const describeClassifyOutcome = (result: ClassifyResult): ClassifyOutcome => {
  if (result.failed) {
    return { kind: "stopped-early", classified: result.classified, remaining: result.remaining };
  }

  // Nothing was asked of the CLI, which is the only case where "everything is
  // already filed" is true.
  if (result.requested === 0) return { kind: "nothing-to-do" };

  return {
    kind: "sorted",
    classified: result.classified,
    costUsd: result.costUsd,
    leftOver: Math.max(0, result.requested - result.queued),
  };
};

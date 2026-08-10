import type { ClassifyResult } from "../../server/core/session/schema.ts";

/** Which conversations a pass was asked to cover, as far as wording cares. */
export type ClassifyScopeKind = "unclassified" | "all" | "selection";

/**
 * What a classification pass amounted to, decided before any wording is chosen.
 *
 * Split out so the rule "when do we say nothing needed doing" is unit tested
 * without a translation catalogue in the way — that claim was wrong before, and
 * a pass that answered but matched nothing reported itself as already sorted.
 *
 * Shared rather than per-interface: the web app turns this into toasts and the
 * terminal board turns it into a status line, and a pass must not describe
 * itself differently depending on which one asked for it.
 */
export type ClassifyOutcome =
  | { readonly kind: "stopped-early"; readonly classified: number; readonly remaining: number }
  /** Nothing was asked of the CLI because every conversation already has a topic. */
  | { readonly kind: "nothing-to-do" }
  /** Nothing was asked because none of the picked conversations could be sorted. */
  | { readonly kind: "nothing-matched" }
  | {
      readonly kind: "sorted";
      readonly classified: number;
      readonly costUsd: number;
      /** Left for the next pass by the per-pass cap. */
      readonly leftOver: number;
    };

export const describeClassifyOutcome = (
  result: ClassifyResult,
  scope: ClassifyScopeKind,
): ClassifyOutcome => {
  if (result.failed) {
    return { kind: "stopped-early", classified: result.classified, remaining: result.remaining };
  }

  // Nothing was asked of the CLI. For a default pass that means everything is
  // filed; for a hand-picked one it means the picks were unclassifiable, which
  // is a different sentence entirely.
  if (result.requested === 0) {
    return { kind: scope === "selection" ? "nothing-matched" : "nothing-to-do" };
  }

  return {
    kind: "sorted",
    classified: result.classified,
    costUsd: result.costUsd,
    leftOver: Math.max(0, result.requested - result.queued),
  };
};

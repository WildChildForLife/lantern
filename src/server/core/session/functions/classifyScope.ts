import { z } from "zod";
import { MAX_CLASSIFY_PER_PASS } from "../../../../lib/topics/classifyLimits.ts";

/**
 * Which conversations a classification pass is allowed to touch.
 *
 * The default is deliberately the cheap one. A conversation that already has a
 * topic is never re-classified unless the user picked it out by hand: paying an
 * agent CLI again for a conversation that is already filed is a surprise, not a
 * feature.
 */
export type ClassifyScope =
  | { readonly kind: "unclassified" }
  | { readonly kind: "all" }
  | { readonly kind: "selection"; readonly sessionIds: readonly string[] };

export const classifyQuerySchema = z.object({
  scope: z.enum(["unclassified", "all"]).optional(),
  /**
   * Legacy. Pre-scope clients said `force=true` for what is now `scope=all`.
   * Kept so a tab left open across an upgrade still redoes what it meant to.
   */
  force: z.enum(["true", "false"]).optional(),
});

export type ClassifyQuery = z.infer<typeof classifyQuerySchema>;

/**
 * A selection is a body rather than a query: session ids run to the hundreds and
 * would blow the URL length well before the cap.
 *
 * Capped at what one pass can actually take. Accepting more would mean silently
 * discarding the overflow, and a caller cannot tell which ids survived.
 */
export const classifySelectionBodySchema = z.object({
  sessionIds: z.array(z.string().min(1)).min(1).max(MAX_CLASSIFY_PER_PASS),
});

/** An explicit `scope` wins; `force=true` is only consulted without one. */
export const scopeFromQuery = (query: ClassifyQuery): ClassifyScope => {
  if (query.scope !== undefined) return { kind: query.scope };
  if (query.force === "true") return { kind: "all" };
  return { kind: "unclassified" };
};

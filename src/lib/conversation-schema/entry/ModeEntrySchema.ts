import { z } from "zod";

/**
 * Records which input mode the CLI was in (normal, plan, ...).
 * Bookkeeping only - it has no counterpart on screen.
 */
export const ModeEntrySchema = z.object({
  type: z.literal("mode"),
  mode: z.string(),
  sessionId: z.string(),
});

export type ModeEntry = z.infer<typeof ModeEntrySchema>;

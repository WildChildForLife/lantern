import { z } from "zod";

/**
 * Records that the session moved to another working directory, e.g. when it
 * entered a git worktree. Bookkeeping only - it has no counterpart on screen.
 */
export const RelocatedEntrySchema = z.object({
  type: z.literal("relocated"),
  sessionId: z.string(),
  relocatedCwd: z.string(),
});

export type RelocatedEntry = z.infer<typeof RelocatedEntrySchema>;

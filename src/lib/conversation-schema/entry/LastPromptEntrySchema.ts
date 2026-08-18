import { z } from "zod";

/**
 * Marks where the session was left off. Older Claude Code versions wrote the
 * prompt text itself; newer ones only point at the leaf message. Both shapes
 * are bookkeeping, so accept either rather than rejecting the line.
 */
export const LastPromptEntrySchema = z.object({
  type: z.literal("last-prompt"),
  sessionId: z.string(),
  lastPrompt: z.string().optional(),
  leafUuid: z.string().optional(),
});

export type LastPromptEntry = z.infer<typeof LastPromptEntrySchema>;

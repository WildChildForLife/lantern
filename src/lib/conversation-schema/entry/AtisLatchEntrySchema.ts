import { z } from "zod";

/**
 * Written by Claude Code 2.1.258, several times per session, carrying nothing
 * but a session id and a string. What the string is for is not known — every
 * captured line held an empty one — so it is accepted as any string rather
 * than as a set someone guessed at, and treated as bookkeeping.
 *
 * Here because the harness in `docker/` ran 2.1.258 and read back what it
 * wrote, not because a format description said so. Without it the line fails
 * the union, and `parseJsonl` renders each one as a parse error in a session
 * that is otherwise fine.
 */
export const AtisLatchEntrySchema = z.object({
  type: z.literal("atis-latch"),
  atis: z.string(),
  sessionId: z.string(),
});

export type AtisLatchEntry = z.infer<typeof AtisLatchEntrySchema>;

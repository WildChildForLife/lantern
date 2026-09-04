import { z } from "zod";

/**
 * Written by Claude Code 2.1.258 — the one captured session held two — carrying
 * nothing but a session id and a string. What the string is for is not known,
 * since both captured lines held an empty one, so it is accepted as any string
 * rather than as a set someone guessed at, and treated as bookkeeping. Left
 * non-strict on purpose: a field the CLI adds later should be dropped, not
 * turned into a parse error.
 *
 * Here because the harness in `docker/` ran 2.1.258 and read back what it
 * wrote, not because a format description said so. Without it the line fails
 * the union, `parseJsonl` returns it as `x-error`, and the transcript draws a
 * parse error in a session that is otherwise fine.
 */
export const AtisLatchEntrySchema = z.object({
  type: z.literal("atis-latch"),
  atis: z.string(),
  sessionId: z.string(),
});

export type AtisLatchEntry = z.infer<typeof AtisLatchEntrySchema>;

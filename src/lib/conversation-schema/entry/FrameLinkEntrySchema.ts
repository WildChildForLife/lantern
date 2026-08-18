import { z } from "zod";

/**
 * Links a local file to the artifact page it was published to. Bookkeeping
 * only - the transcript already carries the tool call that published it.
 */
export const FrameLinkEntrySchema = z.object({
  type: z.literal("frame-link"),
  sessionId: z.string(),
  path: z.string(),
  frameUrl: z.string(),
  title: z.string().optional(),
  timestamp: z.string().optional(),
});

export type FrameLinkEntry = z.infer<typeof FrameLinkEntrySchema>;

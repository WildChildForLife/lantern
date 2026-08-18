import { z } from "zod";

/**
 * A single file backup taken between two file-history snapshots, so an edit can
 * be rewound. Bookkeeping only - it has no counterpart on screen.
 */
export const FileHistoryDeltaEntrySchema = z.object({
  type: z.literal("file-history-delta"),
  messageId: z.string(),
  snapshotMessageId: z.string(),
  trackingPath: z.string(),
  backup: z
    .object({
      backupFileName: z.string().nullable().optional(),
      version: z.number().optional(),
      backupTime: z.string().optional(),
      realParentDir: z.string().optional(),
    })
    .loose(),
  timestamp: z.string(),
});

export type FileHistoryDeltaEntry = z.infer<typeof FileHistoryDeltaEntrySchema>;

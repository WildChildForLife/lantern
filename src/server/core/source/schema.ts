import { z } from "zod";
import { CLAUDE_CODE_SOURCE_ID, sourceIdSchema } from "./models/SourceId.ts";

/**
 * Which agent CLIs Lantern reads, persisted server-side.
 *
 * This cannot live in the per-browser config cookie: ingestion and file
 * watching are process-wide singletons started once at boot, so the setting has
 * to be readable without a request.
 */
export const sourceConfigSchema = z.object({
  enabled: z.array(sourceIdSchema).default([CLAUDE_CODE_SOURCE_ID]),
});

export type SourceConfig = z.infer<typeof sourceConfigSchema>;

export const defaultSourceConfig: SourceConfig = sourceConfigSchema.parse({});

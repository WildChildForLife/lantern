import { z } from "zod";

/**
 * The agent CLIs Lantern can read sessions from. Closed set: every id here has
 * a registered adapter, and ids are persisted on `projects`/`sessions` rows, so
 * removing one is a migration rather than an edit.
 */
export const sourceIdSchema = z.enum(["claude-code", "codex", "opencode"]);

export type SourceId = z.infer<typeof sourceIdSchema>;

export const CLAUDE_CODE_SOURCE_ID: SourceId = "claude-code";
export const CODEX_SOURCE_ID: SourceId = "codex";
export const OPENCODE_SOURCE_ID: SourceId = "opencode";

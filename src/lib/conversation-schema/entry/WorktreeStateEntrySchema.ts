import { z } from "zod";

/**
 * Snapshot of the git worktree a session is working in. Bookkeeping only - it
 * has no counterpart on screen.
 *
 * Deliberately lenient: Claude Code has grown fields here across releases, and
 * an unknown one must not turn the entry into a parse error.
 */
export const WorktreeStateEntrySchema = z.object({
  type: z.literal("worktree-state"),
  sessionId: z.string(),
  // Null once the session leaves the worktree again.
  worktreeSession: z
    .object({
      worktreeName: z.string().optional(),
      worktreePath: z.string().optional(),
      worktreeBranch: z.string().optional(),
      originalCwd: z.string().optional(),
      originalBranch: z.string().optional(),
      originalHeadCommit: z.string().optional(),
      sessionId: z.string().optional(),
    })
    .loose()
    .nullable(),
});

export type WorktreeStateEntry = z.infer<typeof WorktreeStateEntrySchema>;

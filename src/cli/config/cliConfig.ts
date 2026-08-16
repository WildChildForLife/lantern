import { z } from "zod";

/**
 * What pressing Enter on a conversation does.
 *
 * Shown in the board's header and cycled with `e`. All three also have a key of
 * their own, so this only decides what Enter does.
 *
 * Everything here happens in the terminal Lantern is already running in.
 * Opening a second window was tried and removed: it meant detecting an emulator,
 * guessing its flags, and reporting a launch that had already been backgrounded
 * — three ways to fail at something the shell in front of the user does better.
 */
export const resumeActionSchema = z.enum(["resume-here", "print", "copy-id"]);

export type ResumeAction = z.infer<typeof resumeActionSchema>;

/** The order `e` walks through on the board. */
export const RESUME_ACTIONS: readonly ResumeAction[] = ["resume-here", "print", "copy-id"];

/** Human wording for what Enter will do, for the board to show. */
export const RESUME_ACTION_LABELS: Record<ResumeAction, string> = {
  "resume-here": "resume here",
  print: "print the command",
  "copy-id": "copy the id",
};

export const nextResumeAction = (current: ResumeAction): ResumeAction =>
  RESUME_ACTIONS[(RESUME_ACTIONS.indexOf(current) + 1) % RESUME_ACTIONS.length] ?? "resume-here";

export const browseConfigSchema = z.object({
  resumeAction: resumeActionSchema.default("resume-here"),
});

export type BrowseConfig = z.infer<typeof browseConfigSchema>;

/**
 * Settings the `init` wizard writes to `~/.lantern/config.json`.
 *
 * Every key is optional: the file answers only what the user was asked, and the
 * rest keeps falling through to the environment and the built-in defaults.
 *
 * There is deliberately no `password` key. Storing it would put a secret in a
 * plaintext file that dotfile repositories and backups pick up, so the wizard
 * points at `--password` / `LANTERN_PASSWORD` instead.
 */
export const cliConfigSchema = z.object({
  port: z.coerce.number().int().min(1).max(65535).optional(),
  hostname: z.string().optional(),
  claudeDir: z.string().optional(),
  executable: z.string().optional(),
  terminalDisabled: z.boolean().optional(),
  terminalShell: z.string().optional(),
  terminalUnrestricted: z.boolean().optional(),
  apiOnly: z.boolean().optional(),
  /**
   * Whether to say when a newer Lantern has been published. Unset means yes.
   *
   * The one setting here nobody is asked for during setup: it is written by
   * hand, by somebody who would rather Lantern never spoke to the registry.
   * `NO_UPDATE_NOTIFIER` and `LANTERN_NO_UPDATE_NOTIFIER` do the same per run.
   */
  updateNotifier: z.boolean().optional(),
  browse: browseConfigSchema.prefault({}),
});

export type CliConfig = z.infer<typeof cliConfigSchema>;

export const defaultCliConfig: CliConfig = cliConfigSchema.parse({});

/**
 * Parses stored settings, returning null when the file cannot be trusted.
 *
 * Callers fall back to the defaults rather than refusing to start: a broken
 * config costs the user their preferences, which beats an install that will not
 * boot until they find and delete a file.
 */
export const parseCliConfig = (raw: unknown): CliConfig | null => {
  const result = cliConfigSchema.safeParse(raw);

  return result.success ? result.data : null;
};

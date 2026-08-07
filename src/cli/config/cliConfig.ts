import { z } from "zod";

/**
 * What pressing Enter on a conversation does.
 *
 * Shown in the board's header and cycled with `e`. All four also have a key of
 * their own, so this only decides what Enter does.
 */
export const resumeActionSchema = z.enum(["resume-here", "new-window", "print", "copy-id"]);

export type ResumeAction = z.infer<typeof resumeActionSchema>;

/** The order `e` walks through on the board. */
export const RESUME_ACTIONS: readonly ResumeAction[] = [
  "resume-here",
  "new-window",
  "print",
  "copy-id",
];

/** Human wording for what Enter will do, for the board to show. */
export const RESUME_ACTION_LABELS: Record<ResumeAction, string> = {
  "resume-here": "resume here",
  "new-window": "open a new window",
  print: "print the command",
  "copy-id": "copy the id",
};

export const nextResumeAction = (current: ResumeAction): ResumeAction =>
  RESUME_ACTIONS[(RESUME_ACTIONS.indexOf(current) + 1) % RESUME_ACTIONS.length] ?? "resume-here";

export const browseConfigSchema = z.object({
  resumeAction: resumeActionSchema.default("resume-here"),
  /**
   * Command template for "open in a new terminal window", overriding detection.
   * `{{command}}` is replaced with the shell command to run, `{{cwd}}` with the
   * directory to run it in.
   */
  terminalCommand: z.string().optional(),
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

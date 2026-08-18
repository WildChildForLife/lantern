import { z } from "zod";

export const envSchema = z.object({
  LANTERN_ENV: z.enum(["development", "production", "test"]).optional().default("development"),
  HOME: z.string().optional(),
  /** Windows names the home directory here and leaves `HOME` unset. */
  USERPROFILE: z.string().optional(),
  PATH: z.string().optional(),
  /**
   * The address to bind to. Deliberately not the bare `HOSTNAME`: Docker and
   * Kubernetes set that to the container id, and binding to it makes the server
   * unreachable.
   */
  LANTERN_HOSTNAME: z.string().optional(),
  SHELL: z.string().optional(),
  /**
   * Read only to tell whether a bind beyond this machine would be protected.
   * The setup wizard never writes a password down, so the environment is the
   * only place it can look.
   */
  LANTERN_PASSWORD: z.string().optional(),
  LANTERN_TERMINAL_SHELL: z.string().optional(),
  LANTERN_TERMINAL_UNRESTRICTED: z.string().optional(),
  LANTERN_TERMINAL_DISABLED: z.string().optional(),
  /** Codex CLI honours this for its own history; Lantern reads the same one. */
  CODEX_HOME: z.string().optional(),
  /**
   * opencode keeps its history under the XDG data directory rather than a home
   * of its own, so this is the variable that moves it.
   */
  XDG_DATA_HOME: z.string().optional(),
  /**
   * Where the node version managers keep their installs. Read only to find a
   * `claude` that PATH does not carry, which is the normal state of affairs
   * when Claude Code was installed under a different node version than the one
   * running Lantern.
   */
  NVM_DIR: z.string().optional(),
  FNM_DIR: z.string().optional(),
  VOLTA_HOME: z.string().optional(),
  PNPM_HOME: z.string().optional(),
  /** Windows names the per-user application directory here. */
  APPDATA: z.string().optional(),
  /**
   * Read only to tell how Claude Code is billed - either of these means a
   * metered key is in use, whatever login is stored on disk. The values
   * themselves are credentials and are never read, logged or sent anywhere.
   */
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_AUTH_TOKEN: z.string().optional(),
  /**
   * Routing Claude Code through a cloud account is metered too, and sets
   * neither variable above.
   */
  CLAUDE_CODE_USE_BEDROCK: z.string().optional(),
  CLAUDE_CODE_USE_VERTEX: z.string().optional(),
});

export type EnvSchema = z.infer<typeof envSchema>;

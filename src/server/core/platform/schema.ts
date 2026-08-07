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
});

export type EnvSchema = z.infer<typeof envSchema>;

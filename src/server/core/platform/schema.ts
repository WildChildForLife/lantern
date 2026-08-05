import { z } from "zod";

export const envSchema = z.object({
  LANTERN_ENV: z.enum(["development", "production", "test"]).optional().default("development"),
  HOME: z.string().optional(),
  PATH: z.string().optional(),
  SHELL: z.string().optional(),
  LANTERN_TERMINAL_SHELL: z.string().optional(),
  LANTERN_TERMINAL_UNRESTRICTED: z.string().optional(),
  LANTERN_TERMINAL_DISABLED: z.string().optional(),
  /** Codex CLI honours this for its own history; Lantern reads the same one. */
  CODEX_HOME: z.string().optional(),
});

export type EnvSchema = z.infer<typeof envSchema>;

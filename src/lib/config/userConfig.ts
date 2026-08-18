import z from "zod";
import { localeSchema } from "../i18n/schema.ts";

export const userConfigSchema = z.object({
  hideNoUserMessageSession: z.boolean().optional().default(true),
  unifySameTitleSession: z.boolean().optional().default(false),
  enterKeyBehavior: z
    .enum(["shift-enter-send", "enter-send", "command-enter-send"])
    .optional()
    .default("shift-enter-send"),
  locale: localeSchema.optional().default("en"),
  theme: z.enum(["light", "dark", "system"]).optional().default("system"),
  searchHotkey: z.enum(["ctrl-k", "command-k"]).optional().default("command-k"),
  findHotkey: z.enum(["ctrl-f", "command-f"]).optional().default("command-f"),
  autoScheduleContinueOnRateLimit: z.boolean().optional().default(false),
  /**
   * Show the rows a session log keeps for its own sake - hook summaries,
   * queued prompts, file backups. Off by default: a transcript should read
   * like what the person saw, not like the file it was recovered from.
   */
  showTechnicalDetails: z.boolean().optional().default(false),
  modelChoices: z.array(z.string()).optional().default(["default", "haiku", "sonnet", "opus"]),
  /**
   * How Claude Code is paid for, when someone has said so explicitly.
   *
   * `auto` is a real answer - "follow the machine" - and is why this is not
   * merely absent: undefined means nobody has been asked yet, and only that
   * state may raise the first-run question.
   */
  usageMode: z.enum(["subscription", "api", "auto"]).optional(),
  /**
   * The agent CLI Lantern works with: whose history it centres on, and which
   * one names topics. One at a time — these CLIs do not share a login, and
   * asking two of them the same question would bill two accounts.
   *
   * Deliberately not the `SourceId` enum: this schema is shared with the
   * browser bundle, and an id a future build no longer knows should read as
   * unset rather than failing the whole config.
   */
  primarySource: z.string().optional(),
});

export const defaultUserConfig = userConfigSchema.parse({});

export type UserConfig = z.infer<typeof userConfigSchema>;

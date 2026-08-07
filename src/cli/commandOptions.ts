import { z } from "zod";

/**
 * The options a subcommand shares with the root command.
 *
 * Every one of these is declared on `lantern` itself as well, and commander
 * resolves a flag against the root command wherever it appears — so
 * `lantern browse --claude-dir …` is parsed by the root, and the subcommand's
 * own `opts()` comes back empty. Reading `optsWithGlobals()` is what makes the
 * flag mean the same thing on either side of the subcommand name.
 */
const sharedOptionsSchema = z.object({
  claudeDir: z.string().optional(),
  executable: z.string().optional(),
  verbose: z.boolean().optional(),
  source: z.array(z.string()).optional(),
});

export type SharedCommandOptions = z.infer<typeof sharedOptionsSchema>;

/**
 * Reads the flags a subcommand cares about, whichever command parsed them.
 *
 * Validated rather than asserted: commander types its option bag as an open
 * record, and everything downstream of here expects real strings.
 */
export const parseSharedOptions = (raw: unknown): SharedCommandOptions => {
  const result = sharedOptionsSchema.safeParse(raw);

  return result.success ? result.data : {};
};

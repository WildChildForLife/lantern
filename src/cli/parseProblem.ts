/**
 * What to print when commander cannot make sense of the flags it was given.
 *
 * Commander's own text opens with `error:`, which is the one word Lantern never
 * says to somebody who has simply mistyped a flag. The rest of the line is
 * worth keeping exactly as it is — it names the flag, and commander sometimes
 * follows it with a suggestion of its own, which is the most useful part of the
 * whole message.
 *
 * `commandPath` is whichever command hit the problem, so the help it points at
 * is the help that lists the flag that was missed.
 */
export const describeParseProblem = (raw: string, commandPath: string): string => {
  const stated = raw.trimEnd().replace(/^error:\s*/u, "");

  return [stated, "", `Run \`${commandPath} --help\` for the flags it takes.`].join("\n");
};

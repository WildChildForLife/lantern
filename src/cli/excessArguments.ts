/**
 * What to print when a subcommand is handed words it has no use for.
 *
 * None of Lantern's subcommands take a positional argument — everything they
 * read is a flag — so anything left over is a mistake worth naming rather than
 * a value worth guessing at. `lantern browse orders-api` is somebody expecting
 * to open one project; saying so beats browsing everything as though they had
 * not asked.
 *
 * Returns `null` when there is nothing left over, which is every correct run.
 */
export const describeExcessArguments = (
  given: readonly string[],
  commandPath: string,
): string | null => {
  if (given.length === 0) {
    return null;
  }

  const stray = given.map((word) => `'${word}'`).join(", ");

  return [
    `\`${commandPath}\` takes no arguments, but got ${stray}.`,
    "",
    `Run \`${commandPath} --help\` for the options it does take.`,
  ].join("\n");
};

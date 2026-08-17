/** A command the program answers to, under its own name or an alias. */
export type KnownCommand = {
  name: string;
  aliases: readonly string[];
};

/**
 * How many single-character edits turn one word into the other.
 *
 * The usual two-row Levenshtein: only the previous row is ever read, so the
 * table never has to exist.
 */
const editDistance = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];

    for (let column = 1; column <= b.length; column += 1) {
      const swapped = a[row - 1] === b[column - 1] ? 0 : 1;

      current.push(
        Math.min(
          (previous[column - 1] ?? 0) + swapped,
          (current[column - 1] ?? 0) + 1,
          (previous[column] ?? 0) + 1,
        ),
      );
    }

    previous = current;
  }

  return previous[b.length] ?? 0;
};

/** Below this, a word is too short for a typo to be told from a different word. */
const shortestGuessable = 3;

/** Edits allowed between what was typed and the command it is taken to mean. */
const allowedEdits = 2;

/**
 * The command a mistyped word was probably meant to be, or `null`.
 *
 * Aliases are matched as well as names — they are how the command is spelled,
 * so a typo of one is still a typo of the command — but what comes back is
 * always the full name, because that is the useful thing to print.
 */
export const nearestCommand = (typed: string, known: readonly KnownCommand[]): string | null => {
  if (typed.length < shortestGuessable) {
    return null;
  }

  const word = typed.toLowerCase();

  const ranked = known
    .flatMap((command) =>
      [command.name, ...command.aliases].map((spelling) => ({
        name: command.name,
        distance: editDistance(word, spelling.toLowerCase()),
      })),
    )
    .filter((candidate) => candidate.distance <= allowedEdits)
    // Name second, so that two equally close commands always resolve the same
    // way rather than by whichever was registered first.
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));

  return ranked[0]?.name ?? null;
};

/**
 * What to print when the arguments name no command Lantern has.
 *
 * Commander's own answer is "too many arguments. Expected 0 arguments but got
 * 1", because a plain `lantern` starts the web UI and so the root command has
 * an action of its own: a mistyped subcommand arrives as one argument too many
 * rather than as an unknown command. That message describes the parser's
 * problem rather than the reader's, and never mentions the word it choked on.
 *
 * Returns `null` when there is nothing to complain about, which is every launch
 * that meant to start the server.
 */
export const describeUnknownCommand = (
  given: readonly string[],
  known: readonly KnownCommand[],
  programName: string,
): string | null => {
  const typed = given[0];

  if (typed === undefined) {
    return null;
  }

  // Only the first word is being read as a command. Anything after it was meant
  // as an argument to whatever that word was supposed to be, so repeating it
  // back would only bury the part that is wrong.
  const suggestion = nearestCommand(typed, known);
  const names = known.map((command) => command.name).join(", ");

  const opening =
    suggestion === null
      ? `error: unknown command '${typed}'`
      : `error: unknown command '${typed}'. Did you mean \`${programName} ${suggestion}\`?`;

  return [
    opening,
    "",
    `Commands: ${names}. \`${programName}\` on its own starts the web UI, and`,
    `\`${programName} --help\` lists the options.`,
  ].join("\n");
};

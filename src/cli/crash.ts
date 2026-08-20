/** Where a crash is worth reporting, and the one link the message carries. */
const ISSUES_URL = "https://github.com/WildChildForLife/lantern/issues";

/**
 * The one line that says what went wrong, from whatever was thrown.
 *
 * `String(error)` on an `Error` gives "Error: EADDRINUSE…", which puts the word
 * back that the rest of this file exists to remove.
 */
const statement = (error: unknown): string | null => {
  if (error instanceof Error) {
    return error.message === "" ? null : error.message;
  }

  const text = String(error);

  return text === "" || text === "undefined" || text === "null" ? null : text;
};

/**
 * What to print when Lantern falls over, rather than the raw throw.
 *
 * An unexpected failure is the one place a stack trace is genuinely useful, and
 * the one place it helps nobody by default: it is four lines of somebody else's
 * bundle before the line that matters. So the message states the problem, and
 * `--verbose` is what turns the stack on — which also makes "run it again with
 * `--verbose`" the one instruction worth giving, because the output it produces
 * is what a bug report needs.
 */
export const describeCrash = (error: unknown, verbose: boolean): string => {
  const said = statement(error);
  const stack = verbose && error instanceof Error ? error.stack : undefined;

  return [
    "Lantern stopped unexpectedly.",
    ...(said === null ? [] : ["", `  ${said}`]),
    ...(stack === undefined ? [] : ["", stack]),
    "",
    verbose
      ? `Please report it at ${ISSUES_URL}`
      : `Run the same command with --verbose to see more, and please report it at\n${ISSUES_URL}`,
  ].join("\n");
};

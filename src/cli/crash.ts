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

  // Narrowed one type at a time rather than handed to `String`, which answers
  // "[object Object]" for the case that most needs describing — and says so
  // just as confidently as it reports a real message.
  if (typeof error === "string") {
    return error === "" ? null : error;
  }

  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return error.toString();
  }

  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error) ?? null;
    } catch {
      // Circular, or something that throws from its own `toJSON`. The heading
      // above already says Lantern stopped; a placeholder adds nothing.
      return null;
    }
  }

  return null;
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

/**
 * What a bare `lantern` should start.
 *
 * `both` is the default the command was renamed for: one word starts the web
 * server and the terminal board together, and the two `--*-only` flags are how
 * somebody asks for one half of that on its own.
 */
export type RunMode = "both" | "cli" | "server" | "conflict";

export type RunModeInput = {
  cliOnly: boolean;
  serverOnly: boolean;
  /**
   * Whether there is a terminal on both stdin and stdout.
   *
   * Both, because the board reads keys from one and draws on the other.
   */
  interactive: boolean;
};

/**
 * What `lantern --cli-only --server-only` is told.
 *
 * Both halves are printed rather than only the rule that was broken: somebody
 * who reached for both flags knows what they want and has picked the wrong way
 * to ask for it, so the useful reply is the three spellings, not a scolding.
 */
export const describeRunModeConflict = (programName: string): string =>
  [
    "--cli-only and --server-only ask for opposite things.",
    "",
    `  ${programName}                 both, together`,
    `  ${programName} --cli-only      the board alone`,
    `  ${programName} --server-only   the web UI alone`,
  ].join("\n");

/**
 * Decides what a bare `lantern` runs, from the flags and the terminal it has.
 *
 * The two flags are answered before the terminal is, so `--cli-only` in a pipe
 * still reaches the board and is turned away by it in those words — a fallback
 * to the server there would silently start something nobody asked for. Only the
 * default is allowed to fall back, because that is what a container, a service
 * file or a CI job runs, and none of them have a screen to draw a board on.
 */
export const resolveRunMode = ({ cliOnly, serverOnly, interactive }: RunModeInput): RunMode => {
  if (cliOnly && serverOnly) {
    return "conflict";
  }

  if (cliOnly) {
    return "cli";
  }

  if (serverOnly) {
    return "server";
  }

  return interactive ? "both" : "server";
};

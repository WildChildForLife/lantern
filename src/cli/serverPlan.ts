import type { ServerPresence } from "./serverPresence.ts";

/**
 * What this launch does about the web server.
 *
 * - `start` — bind the port, as every launch used to.
 * - `attach` — a Lantern is already serving; open the board against it and
 *   leave the server that is up alone.
 * - `blocked` — the port cannot be had and there is nothing sensible to do
 *   instead.
 */
export type ServerPlan = "start" | "attach" | "blocked";

export type ServerPlanInput = {
  /** Only the two modes that want a server ever get this far. */
  mode: "both" | "server";
  presence: ServerPresence;
};

/**
 * Decides whether this launch starts a web server, joins one, or stops.
 *
 * One web server at a time is the rule, and the second `lantern` in a second
 * terminal is the case it exists for: the board reads the cache directly rather
 * than over HTTP, so it needs no server of its own and there is nothing to be
 * gained from starting one. `--server-only` is the mode with no board to fall
 * back to, which is why the same "already serving" answer stops it instead.
 */
export const resolveServerPlan = ({ mode, presence }: ServerPlanInput): ServerPlan => {
  if (presence === "free") {
    return "start";
  }

  if (presence === "lantern" && mode === "both") {
    return "attach";
  }

  return "blocked";
};

/** The two ways on, printed together because either may be the one wanted. */
const waysOn = (programName: string): readonly string[] => {
  const routes: readonly (readonly [string, string])[] = [
    [`${programName} --port 3001`, "to run a second web UI of your own"],
    [`${programName} --cli-only`, "to browse here, without a web UI"],
  ];
  const column = Math.max(...routes.map(([command]) => command.length));

  return routes.map(([command, what]) => `  ${command.padEnd(column)}   ${what}`);
};

/**
 * What `--server-only` is told when a Lantern already holds the port.
 *
 * The running one is left alone and its address is printed, because "already
 * serving" is nine times out of ten good news badly timed — the web UI that was
 * wanted is up, in another terminal, and the reader only needs to be pointed at
 * it.
 */
export const describeAlreadyServing = (url: string, programName: string): string =>
  [
    `Lantern is already serving the web UI at ${url}.`,
    "",
    ...waysOn(programName),
    "",
    "The one already running has not been touched.",
  ].join("\n");

/**
 * What to print when the port is held by something that is not Lantern.
 *
 * Named as somebody else's rather than as a failure of Lantern's, because that
 * is what it is, and because the reader is the only one who can say whether the
 * answer is to move Lantern or to stop whatever is there.
 */
export const describePortOccupied = (hostname: string, port: number, programName: string): string =>
  [
    `Something that is not Lantern is already listening on ${hostname}:${port}.`,
    "",
    ...waysOn(programName),
    "",
    `Set "port" in your Lantern settings to make a different choice stick.`,
  ].join("\n");

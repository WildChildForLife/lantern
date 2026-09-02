import type { RunMode } from "./runMode.ts";
import { type ServerPresence, serverUrl } from "./serverPresence.ts";

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

/**
 * The run modes that want a web server.
 *
 * `Extract` rather than a hand-written pair, so this names members of `RunMode`
 * and a rename over there breaks here. Deliberately not `Exclude`, which would
 * silently widen to admit any mode added later — the whole point is that a new
 * mode has to come and say what it wants from a server.
 */
export type ServerRunMode = Extract<RunMode, "both" | "server">;

export type ServerPlanInput = {
  /** Only the modes that want a server ever get this far. */
  readonly mode: ServerRunMode;
  readonly presence: ServerPresence;
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

/**
 * The two ways on, printed together because either may be the one wanted.
 *
 * The port offered is the one next to the port that failed, rather than a fixed
 * 3001, so the advice is never to retry the port that just turned them away.
 */
const waysOn = (programName: string, port: number): readonly string[] => {
  const routes: readonly (readonly [string, string])[] = [
    [`${programName} --port ${port + 1}`, "to run a second web UI of your own"],
    [`${programName} --cli-only`, "to browse here, without a web UI"],
  ];
  const column = Math.max(...routes.map(([command]) => command.length));

  return routes.map(([command, what]) => `  ${command.padEnd(column)}   ${what}`);
};

/**
 * What a launch is told when a Lantern already holds the port and this one
 * cannot use it — `--server-only`, which has no board to fall back to, or a
 * bare `lantern` that lost the port between the check and the bind.
 *
 * The running one is left alone and its address is printed, because "already
 * serving" is nine times out of ten good news badly timed — the web UI that was
 * wanted is up, in another terminal, and the reader only needs to be pointed at
 * it.
 */
export const describeAlreadyServing = (
  hostname: string,
  port: number,
  programName: string,
): string =>
  [
    `Lantern is already serving the web UI at ${serverUrl(hostname, port)}.`,
    "",
    ...waysOn(programName, port),
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
    ...waysOn(programName, port),
    "",
    `Set "port" in your Lantern settings to make a different choice stick.`,
  ].join("\n");

/**
 * What to print when the port is taken but nothing on it would say by what.
 *
 * The bind is what proves the port is held; the check before it only ever
 * proves what answered. When the two disagree — a process that accepts
 * connections and never replies, a Lantern too busy to answer inside the
 * check's budget — the honest thing is to say the port is taken and stop, not
 * to guess at the tenant. Naming the wrong one sends the reader to fix a
 * machine that has nothing wrong with it.
 */
export const describePortTaken = (hostname: string, port: number, programName: string): string =>
  [
    `Lantern could not bind ${hostname}:${port}, because something else is holding it.`,
    "",
    ...waysOn(programName, port),
    "",
    "Whatever is on that port did not answer, so Lantern cannot say whether it",
    "is another Lantern or something unrelated.",
  ].join("\n");

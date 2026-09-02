import { HttpClient } from "@effect/platform";
import { NodeHttpClient } from "@effect/platform-node";
import { Effect, Layer, Schedule } from "effect";
import { z } from "zod";
import { LOOPBACK_IPV4 } from "../server/core/platform/resolveBindHostname.ts";

/**
 * What is on the port Lantern was about to bind.
 *
 * - `free` — nothing answered, so this launch starts the web server.
 * - `lantern` — a Lantern is already serving there, so this launch does not
 *   start a second one.
 * - `occupied` — something answered, and it was not Lantern.
 */
export type ServerPresence = "free" | "lantern" | "occupied";

const WILDCARD_IPV4 = "0.0.0.0";
const WILDCARD_IPV6 = "::";
const LOOPBACK_IPV6 = "::1";

/**
 * The address to ask about a server bound to `bindHostname`.
 *
 * A wildcard bind is an instruction to `listen`, not somewhere to connect to:
 * opening a connection to `0.0.0.0` is unspecified, and on Windows it fails
 * outright. The loopback of the matching family is the address such a server is
 * reachable on from the machine doing the asking, which is this one.
 *
 * The empty string is belt and braces: `resolveBindHostname` falls back to
 * `localhost` and cannot return one, but an address of nothing is not something
 * to hand to `connect` on the strength of that.
 *
 * Idempotent, so applying it to an address it has already answered with is
 * safe.
 */
export const probeHostname = (bindHostname: string): string => {
  if (bindHostname === WILDCARD_IPV4 || bindHostname === "") {
    return LOOPBACK_IPV4;
  }

  return bindHostname === WILDCARD_IPV6 ? LOOPBACK_IPV6 : bindHostname;
};

/**
 * A bind address turned into something that can sit in front of a `:port`.
 *
 * Both halves in one place, and applied inside the two functions below rather
 * than left to their callers: a bind address and an address you can connect to
 * are different things, and every caller that had to remember to convert
 * between them was a caller that could forget.
 */
const connectHost = (bindHostname: string): string => {
  const host = probeHostname(bindHostname);

  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
};

/** Where a Lantern serving on this bind address can be reached. */
export const serverUrl = (bindHostname: string, port: number): string =>
  `http://${connectHost(bindHostname)}:${port}`;

/**
 * Where to ask.
 *
 * `/api/version` is registered before the auth middleware, so it answers a
 * Lantern with no password set and a Lantern with one in exactly the same way —
 * which is what makes it usable for identifying the thing on the other end,
 * from a launch that has no password to offer. It answers under `--api-only`
 * too. There is a note beside the route saying so; it has to stay above
 * `authRequiredMiddleware` for this to keep working.
 */
export const probeUrl = (bindHostname: string, port: number): string =>
  `${serverUrl(bindHostname, port)}/api/version`;

/**
 * A client that opens a connection, asks, and hangs up.
 *
 * node:http with an agent of its own, rather than the undici client the update
 * check uses. Node's environment proxy support rides the default dispatcher, so
 * on a machine with `HTTP_PROXY` set and no exemption for loopback the question
 * would go to the proxy instead — and a proxy's 407 or 502 reads here as
 * "something is on that port", which would stop a launch dead on a port that
 * was in fact free. An agent constructed here is never consulted about proxies
 * and cannot make that mistake.
 *
 * `keepAlive: false` restates the constructor's own default rather than
 * correcting it — `http.globalAgent` has had keep-alive on since Node 19, but a
 * constructed agent has not. It is written down because this asks one question,
 * once, and leaving a socket open against a Lantern the process has decided not
 * to talk to again should stay deliberate if the default ever moves.
 */
const probeClientLayer = NodeHttpClient.layerWithoutAgent.pipe(
  Layer.provide(NodeHttpClient.makeAgentLayer({ keepAlive: false })),
);

const versionSchema = z.object({ version: z.string() });

/**
 * Whether a body reads like Lantern's own version route.
 *
 * `/api/version` answers `{ "version": "0.6.0" }` and nothing more, so this is
 * as much as there is to go on: another service that happens to serve a
 * `version` string at the same path would pass. Accepted rather than tightened,
 * because the alternative is a marker field that a Lantern already running from
 * an older release would not send — and failing to recognise a real Lantern is
 * the worse of the two mistakes.
 *
 * Kept apart from the request so the shape can be tested without a socket.
 */
export const readsAsLantern = (raw: unknown): boolean => versionSchema.safeParse(raw).success;

/**
 * Asks what, if anything, is already listening on the port.
 *
 * Every failure is `free`, deliberately: a refused connection is the ordinary
 * answer on a port nobody holds, and guessing the other way would refuse to
 * start a server on a port that was never taken. What it costs when the guess
 * is wrong is one wasted attempt at `listen`, which then fails with
 * `EADDRINUSE` — and the caller asks again before it says anything, so a `free`
 * that a bind has just disproved is reported as what it is, rather than as
 * knowledge of what is there. See `describePortTaken`.
 *
 * `free` therefore means "nothing answered", not "the port is available". Only
 * `listen` can say the second thing.
 */
export const probeServerPresence = (
  bindHostname: string,
  port: number,
): Promise<ServerPresence> => {
  // One question, asked with a connection of its own. The client layer is
  // inside this rather than around the retry below on purpose: an attempt that
  // failed on its socket has to be followed by a *new* socket, and building the
  // agent per attempt is what guarantees that.
  const ask = HttpClient.get(probeUrl(bindHostname, port), {
    headers: { accept: "application/json" },
  }).pipe(
    Effect.flatMap((response): Effect.Effect<ServerPresence> => {
      // Anything that answered at all holds the port. Only a body that reads
      // like Lantern's own version route makes it a Lantern.
      if (response.status < 200 || response.status >= 300) {
        return Effect.succeed("occupied");
      }

      return response.json.pipe(
        Effect.map((body): ServerPresence => (readsAsLantern(body) ? "lantern" : "occupied")),
        Effect.catchAll(() => Effect.succeed<ServerPresence>("occupied")),
      );
    }),
    // Inside the retry rather than around it, so an attempt that failed on its
    // socket is followed by a new one. The agent is built per attempt.
    Effect.provide(probeClientLayer),
    Effect.scoped,
  );

  return Effect.runPromise(
    ask.pipe(
      // A single dropped connection is not proof of an empty port, and the
      // answer here decides whether a second web server is started beside a
      // healthy one. A port with nothing on it refuses instantly, so asking
      // again costs nothing on the launches where there was never anything to
      // find.
      Effect.retry(Schedule.recurs(2)),
      // Around the retries, not inside them: this is the budget for answering
      // the question at all, so the retries cannot multiply it. That matters
      // for an address that neither answers nor refuses — a firewall dropping
      // packets — where every attempt would otherwise cost the full wait before
      // anything at all is printed.
      Effect.timeout("2 seconds"),
      Effect.catchAll(() => Effect.succeed<ServerPresence>("free")),
    ),
  );
};

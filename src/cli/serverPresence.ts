import { HttpClient } from "@effect/platform";
import { NodeHttpClient } from "@effect/platform-node";
import { Effect, Layer } from "effect";
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
 */
export const probeHostname = (bindHostname: string): string => {
  if (bindHostname === WILDCARD_IPV4 || bindHostname === "") {
    return LOOPBACK_IPV4;
  }

  return bindHostname === WILDCARD_IPV6 ? LOOPBACK_IPV6 : bindHostname;
};

/** Whether a host has to be bracketed to sit in front of a `:port`. */
const isIpv6Literal = (hostname: string): boolean =>
  hostname.includes(":") && !hostname.startsWith("[");

/**
 * Where to ask.
 *
 * `/api/version` is registered before the auth middleware, so it is the one
 * route that answers a Lantern with no password set and a Lantern with one in
 * exactly the same way — which is what makes it usable for identifying the
 * thing on the other end.
 */
export const probeUrl = (hostname: string, port: number): string => {
  const host = isIpv6Literal(hostname) ? `[${hostname}]` : hostname;

  return `http://${host}:${port}/api/version`;
};

/** Where a Lantern already serving on this port can be reached. */
export const serverUrl = (hostname: string, port: number): string => {
  const host = isIpv6Literal(hostname) ? `[${hostname}]` : hostname;

  return `http://${host}:${port}`;
};

/**
 * A client that opens a connection, asks, and hangs up.
 *
 * node:http rather than undici, because the undici client tears its dispatcher
 * down with the scope and every undici request made afterwards in the same
 * process fails — which would leave this answering `free` for the rest of a
 * launch, whatever is really on the port. The update check has usually already
 * made one undici request by the time anything gets here.
 *
 * Keep-alive off because this asks one question, once, and since Node 19 an
 * agent holds its sockets open by default: there is no second request for a
 * kept connection to save, and no reason to leave one open against a Lantern
 * this process has decided not to talk to again.
 */
const probeClientLayer = NodeHttpClient.layerWithoutAgent.pipe(
  Layer.provide(NodeHttpClient.makeAgentLayer({ keepAlive: false })),
);

const versionSchema = z.object({ version: z.string() });

/** Kept apart from the request so the shape can be tested without a socket. */
export const readsAsLantern = (raw: unknown): boolean => versionSchema.safeParse(raw).success;

/**
 * Asks what, if anything, is already listening on the port.
 *
 * Every failure is `free`, deliberately. A refused connection is the ordinary
 * answer on a port nobody holds and comes back instantly, and the awkward cases
 * — a process that accepts the connection and then says nothing, a host that
 * does not resolve — are ones where guessing `free` costs nothing: the bind
 * that follows either succeeds, or fails with `EADDRINUSE` and prints the same
 * message this would have. Guessing the other way would refuse to start a
 * server on a port that was never taken, which is far worse.
 */
export const probeServerPresence = (bindHostname: string, port: number): Promise<ServerPresence> =>
  Effect.runPromise(
    HttpClient.get(probeUrl(probeHostname(bindHostname), port), {
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
      // Long enough for a busy machine to answer, short enough that nobody
      // notices it happened on the launches where the port is free.
      Effect.timeout("2 seconds"),
      Effect.catchAll(() => Effect.succeed<ServerPresence>("free")),
      Effect.provide(probeClientLayer),
      Effect.scoped,
    ),
  );

// A bare Node HTTP server rather than Lantern's own: what this checks is how
// `stopServer` behaves against Node's `close` semantics, so the server under it
// has to be the plain one those semantics belong to.
import { createServer, get, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { isPortInUse, resolveDevPort, stopServer } from "./startServer.ts";

const listening = (server: Server): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : 0);
    });
  });

/**
 * A request the server answers and then holds open, the way `/api/sse` does.
 *
 * Resolves once the response has started, so the connection is established and
 * unfinished by the time the test asks the server to stop.
 *
 * Retried rather than attempted once, because what this test is about is
 * `stopServer`, not the first TCP handshake. Some loopback stacks refuse the
 * first connection a process makes to a listener it started itself — reproduced
 * on WSL2, where a plain `net.connect` to an own-process server is refused every
 * time while the attempt after it succeeds. Without this the test failed there
 * on a connection that had nothing to do with what it asserts.
 */
const openStream = (port: number, attemptsLeft = 5): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = get({ host: "127.0.0.1", port, path: "/" }, () => {
      resolve();
    });

    request.on("error", (error) => {
      if (attemptsLeft <= 1) {
        reject(error);
        return;
      }

      openStream(port, attemptsLeft - 1).then(resolve, reject);
    });
  });

const opened: Server[] = [];

const serverHoldingConnectionsOpen = (): Server => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(": open\n\n");
  });

  opened.push(server);

  return server;
};

afterEach(() => {
  for (const server of opened.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});

describe("isPortInUse", () => {
  /** What decides between a readable message and the crash screen. */
  it("recognises the port already being taken", () => {
    const error = Object.assign(new Error("listen EADDRINUSE: address already in use"), {
      code: "EADDRINUSE",
    });

    expect(isPortInUse(error)).toBe(true);
  });

  /**
   * Deliberate. A privileged port or an address that is not this machine's are
   * different problems with different answers, and answering them as "something
   * is already there" would send the reader after a process that does not
   * exist. They go to the crash message until they have one of their own.
   */
  it("does not answer for other things listen can fail with", () => {
    expect(isPortInUse(Object.assign(new Error("permission denied"), { code: "EACCES" }))).toBe(
      false,
    );
    expect(
      isPortInUse(Object.assign(new Error("address not available"), { code: "EADDRNOTAVAIL" })),
    ).toBe(false);
  });

  it("does not answer for an error carrying no code at all", () => {
    expect(isPortInUse(new Error("EADDRINUSE"))).toBe(false);
  });

  /** Anything can be thrown, and the check reads a property off it. */
  it("does not answer for things that are not errors", () => {
    expect(isPortInUse({ code: "EADDRINUSE" })).toBe(false);
    expect(isPortInUse("EADDRINUSE")).toBe(false);
    expect(isPortInUse(null)).toBe(false);
    expect(isPortInUse(undefined)).toBe(false);
  });
});

describe("resolveDevPort", () => {
  it("uses the port it was given", () => {
    expect(resolveDevPort("3400")).toBe(3400);
  });

  /**
   * `Number.parseInt` answers `NaN` for all of these, and `NaN` would reach
   * both `listen` and the URL the port check is sent to.
   */
  it("falls back rather than pass NaN on to listen", () => {
    expect(resolveDevPort(undefined)).toBe(3401);
    expect(resolveDevPort("")).toBe(3401);
    expect(resolveDevPort("abc")).toBe(3401);
  });

  it("falls back for a number that is not a port", () => {
    expect(resolveDevPort("0")).toBe(3401);
    expect(resolveDevPort("70000")).toBe(3401);
    expect(resolveDevPort("-1")).toBe(3401);
  });
});

describe("stopServer", () => {
  it("stops a server that nothing is talking to", async () => {
    const server = serverHoldingConnectionsOpen();
    await listening(server);

    await stopServer(server);

    expect(server.listening).toBe(false);
  });

  /**
   * The regression this exists for.
   *
   * `close` alone waits for every open connection to end, and the two this
   * server holds longest — an SSE stream and a terminal WebSocket — never end
   * on their own. A bare `lantern` awaits this before it exits, so a browser
   * tab left open on the web UI used to mean `q` never gave the terminal back.
   */
  it("stops a server with a stream still open, rather than waiting for it", async () => {
    const server = serverHoldingConnectionsOpen();
    const port = await listening(server);
    await openStream(port);

    await stopServer(server);

    expect(server.listening).toBe(false);
  });
});

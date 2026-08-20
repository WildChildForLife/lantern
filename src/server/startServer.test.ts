// A bare Node HTTP server rather than Lantern's own: what this checks is how
// `stopServer` behaves against Node's `close` semantics, so the server under it
// has to be the plain one those semantics belong to.
import { createServer, get, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { stopServer } from "./startServer.ts";

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
 */
const openStream = (port: number): Promise<void> =>
  new Promise((resolve) => {
    get({ host: "127.0.0.1", port, path: "/" }, () => {
      resolve();
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

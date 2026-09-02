import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeHostname, probeServerPresence, probeUrl, readsAsLantern } from "./serverPresence.ts";

describe("probeHostname", () => {
  /** You cannot open a connection to a wildcard; loopback is where it answers. */
  it("asks loopback about a server bound to every IPv4 address", () => {
    expect(probeHostname("0.0.0.0")).toBe("127.0.0.1");
  });

  it("asks IPv6 loopback about a server bound to every address", () => {
    expect(probeHostname("::")).toBe("::1");
  });

  it("asks loopback when no bind address was resolved at all", () => {
    expect(probeHostname("")).toBe("127.0.0.1");
  });

  it("asks a real bind address about itself", () => {
    expect(probeHostname("127.0.0.1")).toBe("127.0.0.1");
    expect(probeHostname("192.168.1.10")).toBe("192.168.1.10");
    expect(probeHostname("lantern.local")).toBe("lantern.local");
  });
});

describe("probeUrl", () => {
  it("builds the address of the one route that answers without a password", () => {
    expect(probeUrl("127.0.0.1", 3000)).toBe("http://127.0.0.1:3000/api/version");
  });

  /** Without the brackets this is a host called `::1` on port `3000`. */
  it("brackets an IPv6 address", () => {
    expect(probeUrl("::1", 3000)).toBe("http://[::1]:3000/api/version");
  });

  it("leaves an already bracketed address alone", () => {
    expect(probeUrl("[::1]", 3000)).toBe("http://[::1]:3000/api/version");
  });

  it("does not bracket a hostname", () => {
    expect(probeUrl("lantern.local", 8080)).toBe("http://lantern.local:8080/api/version");
  });
});

describe("readsAsLantern", () => {
  it("recognises the version Lantern answers with", () => {
    expect(readsAsLantern({ version: "0.6.0" })).toBe(true);
  });

  it("does not take somebody else's JSON for a Lantern", () => {
    expect(readsAsLantern({ status: "ok" })).toBe(false);
    expect(readsAsLantern({ version: 6 })).toBe(false);
    expect(readsAsLantern(null)).toBe(false);
    expect(readsAsLantern("0.6.0")).toBe(false);
  });
});

/**
 * Every stand-in stays up for the whole file, and they all come down together
 * at the end. Closing one between probes drops a connection the client is still
 * holding, which costs the next request — an artefact of asking four questions
 * in one process, and not something a launch ever does.
 */
describe("probeServerPresence", () => {
  const servers: Server[] = [];

  const listen = (handler: Parameters<typeof createServer>[1]): Promise<number> =>
    new Promise((resolve) => {
      const created = createServer(handler);
      servers.push(created);
      created.listen(0, "127.0.0.1", () => {
        const info = created.address();
        resolve(typeof info === "object" && info !== null ? info.port : 0);
      });
    });

  const close = (server: Server): Promise<void> =>
    new Promise((resolve) => {
      server.close(() => {
        resolve();
      });
    });

  let lanternPort = 0;
  let strangerPort = 0;
  let refusingPort = 0;

  beforeAll(async () => {
    lanternPort = await listen((request, response) => {
      if (request.url === "/api/version") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ version: "0.6.0" }));
        return;
      }
      response.writeHead(404);
      response.end();
    });

    strangerPort = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<h1>Directory listing</h1>");
    });

    refusingPort = await listen((_request, response) => {
      response.writeHead(404);
      response.end();
    });
  });

  afterAll(async () => {
    await Promise.all(servers.map((server) => close(server)));
    servers.length = 0;
  });

  it("finds a Lantern behind the port it answers on", async () => {
    expect(await probeServerPresence("127.0.0.1", lanternPort)).toBe("lantern");
  });

  /** Something is there, but it is not going to serve the web UI. */
  it("calls a port held by something else occupied", async () => {
    expect(await probeServerPresence("127.0.0.1", strangerPort)).toBe("occupied");
  });

  it("calls a server that refuses the route occupied rather than free", async () => {
    expect(await probeServerPresence("127.0.0.1", refusingPort)).toBe("occupied");
  });

  /**
   * The port has to come back free for the common case — one Lantern, nothing
   * else — or every launch would refuse to start a server.
   */
  it("calls a port nothing answers on free", async () => {
    const port = await listen((_request, response) => {
      response.end();
    });
    const spare = servers.pop();
    if (spare !== undefined) {
      await close(spare);
    }

    expect(await probeServerPresence("127.0.0.1", port)).toBe("free");
  });
});

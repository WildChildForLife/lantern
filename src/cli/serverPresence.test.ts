import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  probeHostname,
  probeServerPresence,
  probeUrl,
  readsAsLantern,
  serverUrl,
} from "./serverPresence.ts";

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

  /** `serverUrl` and `probeUrl` apply it to addresses it has already answered. */
  it("leaves its own answers alone", () => {
    expect(probeHostname(probeHostname("0.0.0.0"))).toBe("127.0.0.1");
    expect(probeHostname(probeHostname("::"))).toBe("::1");
  });
});

describe("serverUrl", () => {
  it("builds an address a browser can open", () => {
    expect(serverUrl("127.0.0.1", 3000)).toBe("http://127.0.0.1:3000");
  });

  /** Without the brackets this is a host called `::1` on port `3000`. */
  it("brackets an IPv6 address", () => {
    expect(serverUrl("::1", 3000)).toBe("http://[::1]:3000");
  });

  it("does not bracket a hostname", () => {
    expect(serverUrl("lantern.local", 8080)).toBe("http://lantern.local:8080");
  });

  /**
   * The conversion the callers used to have to remember. Printing
   * `http://0.0.0.0:3000` at somebody is printing an address they cannot open.
   */
  it("turns a wildcard bind into an address that can be opened", () => {
    expect(serverUrl("0.0.0.0", 3000)).toBe("http://127.0.0.1:3000");
    expect(serverUrl("::", 3000)).toBe("http://[::1]:3000");
  });
});

describe("probeUrl", () => {
  it("asks the one route that answers without a password", () => {
    expect(probeUrl("127.0.0.1", 3000)).toBe("http://127.0.0.1:3000/api/version");
  });

  it("brackets an IPv6 address", () => {
    expect(probeUrl("::1", 3000)).toBe("http://[::1]:3000/api/version");
  });

  it("asks loopback about a wildcard bind", () => {
    expect(probeUrl("0.0.0.0", 3000)).toBe("http://127.0.0.1:3000/api/version");
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

  /**
   * The known limit, pinned deliberately rather than left to be discovered:
   * `/api/version` serves a bare version string, so anything else serving one
   * at the same path passes. Recognising an older Lantern matters more than
   * turning this case away — see the note on the function.
   */
  it("cannot tell another tool's version route apart, and says so here", () => {
    expect(readsAsLantern({ version: "1.2.3", name: "something-else" })).toBe(true);
  });
});

/**
 * Every stand-in server is listening before the first probe runs.
 *
 * Not tidiness — a constraint of the machine. Some loopback stacks will only
 * carry a connection to a listener that existed before the process made its
 * first outbound request; a server opened afterwards is refused, and the refusal
 * is identical whether the request goes out over node:http or over undici. So a
 * probe of a server started mid-file measures the loopback stack rather than
 * this module. A launch never has that shape: the Lantern it asks about is in
 * another process and was listening long before.
 *
 * The one thing worth pinning from that shape — asking twice in a single
 * process, which a launch does do when it loses the port race — is covered
 * below against a server that was up from the start.
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
  let silentPort = 0;
  let closedPort = 0;

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

    silentPort = await listen(() => {
      // Deliberately no response: the probe has to time out on its own.
    });

    // Opened with the rest, then closed, so the port is one nothing answers on.
    closedPort = await listen((_request, response) => {
      response.end();
    });
    const closable = servers.pop();
    if (closable !== undefined) {
      await close(closable);
    }
  });

  afterAll(async () => {
    await Promise.all(servers.splice(0).map((server) => close(server)));
  });

  it("finds a Lantern behind the port it answers on", async () => {
    expect(await probeServerPresence("127.0.0.1", lanternPort)).toBe("lantern");
  });

  /**
   * A launch that loses the port race probes twice. The second answer has to be
   * as good as the first, or the message it prints is about the wrong thing.
   */
  it("gives the same answer when asked twice in one process", async () => {
    expect(await probeServerPresence("127.0.0.1", lanternPort)).toBe("lantern");
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
    expect(await probeServerPresence("127.0.0.1", closedPort)).toBe("free");
  });

  /**
   * The only guard on the timeout. Lengthening it would freeze every launch
   * behind a process that accepts connections and never answers — and this is
   * also the case that reaches `describePortTaken` rather than a claim about
   * what is on the port.
   */
  it("gives up on a server that accepts and never answers, without hanging", async () => {
    const startedAt = Date.now();
    const presence = await probeServerPresence("127.0.0.1", silentPort);

    expect(presence).toBe("free");
    expect(Date.now() - startedAt).toBeLessThan(20_000);
  });
});

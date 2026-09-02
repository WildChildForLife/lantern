import { describe, expect, it } from "vitest";
import {
  describeAlreadyServing,
  describePortOccupied,
  describePortTaken,
  resolveServerPlan,
} from "./serverPlan.ts";

describe("resolveServerPlan", () => {
  it("starts the server when nothing holds the port", () => {
    expect(resolveServerPlan({ mode: "both", presence: "free" })).toBe("start");
    expect(resolveServerPlan({ mode: "server", presence: "free" })).toBe("start");
  });

  /** The whole point: a second terminal gets a board, not a crash. */
  it("attaches to a Lantern that is already serving", () => {
    expect(resolveServerPlan({ mode: "both", presence: "lantern" })).toBe("attach");
  });

  /**
   * `--server-only` asked for a server and there is nowhere to put one. There
   * is no board to fall back to, so this has to be said rather than worked
   * around.
   */
  it("has nothing to offer --server-only when a Lantern already serves", () => {
    expect(resolveServerPlan({ mode: "server", presence: "lantern" })).toBe("blocked");
  });

  /** Not a Lantern, so there is no running web UI to attach to. */
  it("stops when something else holds the port, whichever was asked for", () => {
    expect(resolveServerPlan({ mode: "both", presence: "occupied" })).toBe("blocked");
    expect(resolveServerPlan({ mode: "server", presence: "occupied" })).toBe("blocked");
  });
});

describe("describeAlreadyServing", () => {
  it("says where the running web UI is", () => {
    expect(describeAlreadyServing("127.0.0.1", 3000, "lantern")).toContain("http://127.0.0.1:3000");
  });

  /** The address has to be one a browser can open, not the bind address. */
  it("turns a wildcard bind into an address that can be opened", () => {
    const message = describeAlreadyServing("0.0.0.0", 3000, "lantern");

    expect(message).toContain("http://127.0.0.1:3000");
    expect(message).not.toContain("0.0.0.0");
  });

  it("offers both ways on: another port, or the board", () => {
    const message = describeAlreadyServing("127.0.0.1", 3000, "lantern");

    expect(message).toContain("lantern --port 3001");
    expect(message).toContain("lantern --cli-only");
  });

  /** Retrying the port that just turned you away is not advice. */
  it("suggests a port other than the one that was taken", () => {
    const message = describeAlreadyServing("127.0.0.1", 3001, "lantern");

    expect(message).toContain("lantern --port 3002");
  });

  it("uses the name the program was invoked under", () => {
    expect(describeAlreadyServing("127.0.0.1", 3000, "lantern-viewer")).toContain(
      "lantern-viewer --cli-only",
    );
  });

  /**
   * The promise this message makes. Without it the reader has no reason to
   * believe the Lantern in the other terminal survived their mistake.
   */
  it("says the running one was left alone", () => {
    expect(describeAlreadyServing("127.0.0.1", 3000, "lantern")).toContain("has not been touched");
  });

  /** Nothing broke; the thing that was wanted is already there. */
  it("does not read as a crash", () => {
    const message = describeAlreadyServing("127.0.0.1", 3000, "lantern").toLowerCase();

    expect(message).not.toContain("eaddrinuse");
    expect(message).not.toContain("error");
  });
});

describe("describePortOccupied", () => {
  it("names the address that is taken", () => {
    expect(describePortOccupied("127.0.0.1", 3000, "lantern")).toContain("127.0.0.1:3000");
  });

  /**
   * Asserted against the other two messages rather than for a word they share:
   * printing "already serving" at somebody whose port is held by a database is
   * the mistake worth catching, and every looser assertion passes for it.
   */
  it("says it is somebody else on the port, not a Lantern", () => {
    const message = describePortOccupied("127.0.0.1", 3000, "lantern");

    expect(message).toContain("is not Lantern");
    expect(message).not.toContain("already serving");
    expect(message).not.toContain("cannot say");
  });

  it("offers both ways on: another port, or the board", () => {
    const message = describePortOccupied("127.0.0.1", 3000, "lantern");

    expect(message).toContain("lantern --port 3001");
    expect(message).toContain("lantern --cli-only");
  });

  it("does not spell the failure the way the operating system did", () => {
    expect(describePortOccupied("127.0.0.1", 3000, "lantern").toLowerCase()).not.toContain(
      "eaddrinuse",
    );
  });
});

describe("describePortTaken", () => {
  it("names the address that could not be bound", () => {
    expect(describePortTaken("127.0.0.1", 3000, "lantern")).toContain("127.0.0.1:3000");
  });

  /**
   * The reason this message exists. The bind proves the port is held; nothing
   * proved what holds it, so neither of the other two messages may be printed.
   */
  it("claims nothing about what is on the port", () => {
    const message = describePortTaken("127.0.0.1", 3000, "lantern");

    expect(message).toContain("cannot say");
    expect(message).not.toContain("is not Lantern");
    expect(message).not.toContain("already serving");
  });

  it("offers both ways on: another port, or the board", () => {
    const message = describePortTaken("127.0.0.1", 3000, "lantern");

    expect(message).toContain("lantern --port 3001");
    expect(message).toContain("lantern --cli-only");
  });

  it("does not spell the failure the way the operating system did", () => {
    expect(describePortTaken("127.0.0.1", 3000, "lantern").toLowerCase()).not.toContain(
      "eaddrinuse",
    );
  });
});

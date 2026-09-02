import { describe, expect, it } from "vitest";
import { describeAlreadyServing, describePortOccupied, resolveServerPlan } from "./serverPlan.ts";

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
    const message = describeAlreadyServing("http://127.0.0.1:3000", "lantern");

    expect(message).toContain("http://127.0.0.1:3000");
  });

  it("offers both ways on: another port, or the board", () => {
    const message = describeAlreadyServing("http://127.0.0.1:3000", "lantern");

    expect(message).toContain("lantern --port");
    expect(message).toContain("lantern --cli-only");
  });

  it("uses the name the program was invoked under", () => {
    expect(describeAlreadyServing("http://127.0.0.1:3000", "lantern-viewer")).toContain(
      "lantern-viewer --cli-only",
    );
  });

  /** Nothing broke; the thing that was wanted is already there. */
  it("does not read as a crash", () => {
    const message = describeAlreadyServing("http://127.0.0.1:3000", "lantern").toLowerCase();

    expect(message).not.toContain("eaddrinuse");
    expect(message).not.toContain("error");
  });
});

describe("describePortOccupied", () => {
  it("names the address that is taken", () => {
    const message = describePortOccupied("127.0.0.1", 3000, "lantern");

    expect(message).toContain("127.0.0.1:3000");
  });

  /** The reader has to be told this is somebody else's, not another Lantern. */
  it("says it is not a Lantern on the other end", () => {
    expect(describePortOccupied("127.0.0.1", 3000, "lantern")).toContain("Lantern");
  });

  it("offers both ways on: another port, or the board", () => {
    const message = describePortOccupied("127.0.0.1", 3000, "lantern");

    expect(message).toContain("lantern --port");
    expect(message).toContain("lantern --cli-only");
  });

  it("does not spell the failure the way the operating system did", () => {
    expect(describePortOccupied("127.0.0.1", 3000, "lantern").toLowerCase()).not.toContain(
      "eaddrinuse",
    );
  });
});

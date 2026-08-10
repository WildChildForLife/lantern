import { describe, expect, it } from "vitest";
import { isLoopback, nextStep, WIZARD_STEPS } from "./steps.ts";

const answers = {
  sources: ["claude-code"] as const,
  hostname: "127.0.0.1",
};

describe("isLoopback", () => {
  it.each(["127.0.0.1", "::1", "localhost"])("treats %s as loopback", (hostname) => {
    expect(isLoopback(hostname)).toBe(true);
  });

  it.each(["0.0.0.0", "::", "192.168.1.10"])("treats %s as reachable", (hostname) => {
    expect(isLoopback(hostname)).toBe(false);
  });
});

describe("nextStep", () => {
  it("walks every step in order for the default answers", () => {
    const visited: string[] = ["sources"];
    let step = nextStep("sources", { ...answers });

    while (step !== "done") {
      visited.push(step);
      step = nextStep(step, { ...answers });
    }

    expect(visited).toStrictEqual([
      "sources",
      "claude-dir",
      "executable",
      "port",
      "hostname",
      "terminal",
      "sync",
    ]);
  });

  /** Nothing to point at, and no CLI to name topics with. */
  it("skips the executable question when Claude Code is not being read", () => {
    expect(nextStep("claude-dir", { ...answers, sources: ["codex"] })).toBe("port");
  });

  it("skips the claude directory question when Claude Code is not being read", () => {
    expect(nextStep("sources", { ...answers, sources: ["codex"] })).toBe("port");
  });

  /** A password only matters once something other than this machine can connect. */
  it("asks about a password only for a reachable bind address", () => {
    expect(nextStep("hostname", { ...answers, hostname: "0.0.0.0" })).toBe("password");
    expect(nextStep("hostname", { ...answers, hostname: "127.0.0.1" })).toBe("terminal");
  });

  /** Switched on the board instead, where the user can see what it applies to. */
  it("never asks what Enter should do", () => {
    expect(nextStep("terminal", { ...answers })).toBe("sync");
    expect(Object.keys(WIZARD_STEPS)).not.toContain("resume-action");
    expect(Object.keys(WIZARD_STEPS)).not.toContain("emulator");
  });

  it("ends after the sync question", () => {
    expect(nextStep("sync", { ...answers })).toBe("done");
  });

  it("knows a title for every step it can reach", () => {
    for (const title of Object.values(WIZARD_STEPS)) {
      expect(title.length).toBeGreaterThan(0);
    }
  });
});

import { describe, expect, it } from "vitest";
import { isLoopback, nextStep, WIZARD_STEPS } from "./steps.ts";

const answers = {
  sources: ["claude-code"] as const,
  hostname: "127.0.0.1",
  resumeAction: "resume-here" as const,
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
      "resume-action",
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

  it("asks which emulator to use only when a new window is the default", () => {
    expect(nextStep("resume-action", { ...answers, resumeAction: "new-window" })).toBe("emulator");
    expect(nextStep("resume-action", { ...answers, resumeAction: "print" })).toBe("sync");
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

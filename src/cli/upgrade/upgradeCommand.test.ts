import { describe, expect, it } from "vitest";
import { parseUpgradeOptions, renderUpgradePlan } from "./upgradeCommand.ts";

describe("parseUpgradeOptions", () => {
  it("reads the flags the command declares", () => {
    expect(parseUpgradeOptions({ check: true, dryRun: true })).toEqual({
      check: true,
      dryRun: true,
    });
  });

  it("falls back to neither rather than trusting a stray option bag", () => {
    expect(parseUpgradeOptions({ check: "yes" })).toEqual({});
    expect(parseUpgradeOptions(undefined)).toEqual({});
  });
});

describe("renderUpgradePlan", () => {
  it("prints the command a refusal is pointing at", () => {
    const text = renderUpgradePlan({
      kind: "refused",
      reason: "Lantern was installed by Homebrew (/opt/homebrew).",
      commands: ["brew update && brew upgrade lantern-viewer"],
      note: null,
    });

    expect(text).toContain("  brew update && brew upgrade lantern-viewer");
    expect(text).toContain("Nothing was changed.");
  });

  it("shows both versions when there is an upgrade to take", () => {
    const text = renderUpgradePlan({
      kind: "available",
      from: "0.3.0",
      to: "0.4.0",
      binary: "npm",
      args: ["install", "-g", "lantern-viewer@latest"],
    });

    expect(text).toContain("0.4.0 is available (you have 0.3.0)");
    expect(text).toContain("  npm install -g lantern-viewer@latest");
  });

  it("says nothing is needed when the newest release is the one installed", () => {
    expect(renderUpgradePlan({ kind: "up-to-date", version: "0.3.0" })).toBe(
      "Lantern 0.3.0 is the latest release.",
    );
  });
});

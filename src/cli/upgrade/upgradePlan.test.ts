import { describe, expect, it } from "vitest";
import type { InstallSource, PackageManager } from "./installSource.ts";
import { makeUpgradePlan, type UpgradePlan } from "./upgradePlan.ts";

const npmGlobal = (manager: PackageManager): InstallSource => ({
  kind: "npm-global",
  manager,
  root: "/usr/local/lib/node_modules",
});

const plan = (
  source: InstallSource,
  overrides: Partial<Parameters<typeof makeUpgradePlan>[0]> = {},
): UpgradePlan =>
  makeUpgradePlan({
    source,
    current: "0.3.0",
    latest: "0.4.0",
    dryRun: false,
    checkOnly: false,
    rootWritable: true,
    ...overrides,
  });

const commandLine = (result: UpgradePlan): string =>
  result.kind === "run" || result.kind === "available"
    ? [result.binary, ...result.args].join(" ")
    : "";

describe("makeUpgradePlan", () => {
  /**
   * The verbs differ between package managers: `pnpm install -g` and
   * `bun install -g` are not commands, and yarn 2 removed `yarn global`
   * altogether. Printing one of those would be worse than refusing.
   */
  it("names the command each package manager actually takes", () => {
    expect(commandLine(plan(npmGlobal("npm")))).toBe("npm install -g lantern-viewer@latest");
    expect(commandLine(plan(npmGlobal("pnpm")))).toBe("pnpm add -g lantern-viewer@latest");
    expect(commandLine(plan(npmGlobal("bun")))).toBe("bun add -g lantern-viewer@latest");
    expect(commandLine(plan(npmGlobal("yarn")))).toBe("yarn global add lantern-viewer@latest");
  });

  it("runs the upgrade when there is one to run", () => {
    const result = plan(npmGlobal("npm"));

    expect(result.kind).toBe("run");
    expect(result.kind === "run" ? [result.from, result.to] : null).toEqual(["0.3.0", "0.4.0"]);
  });

  it("says so when the installed version is already the published one", () => {
    expect(plan(npmGlobal("npm"), { latest: "0.3.0" })).toEqual({
      kind: "up-to-date",
      version: "0.3.0",
    });
  });

  it("stays put when the registry could not be reached", () => {
    expect(plan(npmGlobal("npm"), { latest: null }).kind).toBe("unreachable");
  });

  /** A beta on the `latest` tag is not an upgrade for somebody on a release. */
  it("does not offer a prerelease to a stable install", () => {
    expect(plan(npmGlobal("npm"), { latest: "0.4.0-beta.1" }).kind).toBe("up-to-date");
  });

  it("reports without running for --check and --dry-run", () => {
    for (const overrides of [{ checkOnly: true }, { dryRun: true }]) {
      const result = plan(npmGlobal("npm"), overrides);

      expect(result.kind).toBe("available");
      expect(commandLine(result)).toBe("npm install -g lantern-viewer@latest");
    }
  });

  /** Lantern never runs `sudo` for the user; it says which command needs it. */
  it("refuses rather than escalating when the install is not writable", () => {
    const result = plan(npmGlobal("npm"), { rootWritable: false });

    expect(result.kind).toBe("refused");
    expect(result.kind === "refused" ? result.commands : []).toEqual([
      "sudo npm install -g lantern-viewer@latest",
    ]);
  });

  it("leaves an install it did not make alone, and says what would upgrade it", () => {
    const cases: ReadonlyArray<{ source: InstallSource; command: string }> = [
      { source: { kind: "homebrew", prefix: "/opt/homebrew" }, command: "brew upgrade" },
      { source: { kind: "system-package", manager: "apt" }, command: "sudo apt remove lantern" },
      { source: { kind: "system-package", manager: "dnf" }, command: "sudo dnf remove lantern" },
      { source: { kind: "docker" }, command: "docker pull" },
      { source: { kind: "npx-cache" }, command: "npm install -g lantern-viewer" },
      { source: { kind: "git-checkout", root: "/home/u/code/lantern" }, command: "git pull" },
      { source: { kind: "unknown", path: "/opt/weird/main.js" }, command: "npm install -g" },
    ];

    for (const { source, command } of cases) {
      const result = plan(source);

      expect(result.kind).toBe("refused");
      expect(result.kind === "refused" ? result.commands.join("\n") : "").toContain(command);
    }
  });

  /**
   * The retired channels are the reason this command exists: a .deb user has to
   * be told the packages have stopped, not merely that Lantern will not touch
   * them.
   */
  it("tells a deb or rpm install how to move to npm", () => {
    const result = plan({ kind: "system-package", manager: "apt" });
    const text = result.kind === "refused" ? `${result.reason}\n${result.commands.join("\n")}` : "";

    expect(text).toContain("retired");
    expect(text).toContain("npm install -g lantern-viewer");
  });

  it("gives every refusal something the user can act on", () => {
    const sources: readonly InstallSource[] = [
      { kind: "homebrew", prefix: "/opt/homebrew" },
      { kind: "system-package", manager: "unknown" },
      { kind: "docker" },
      { kind: "npx-cache" },
      { kind: "git-checkout", root: "/home/u/code/lantern" },
      { kind: "unknown", path: "/opt/weird/main.js" },
    ];

    for (const source of sources) {
      const result = plan(source);

      expect(result.kind === "refused" ? result.reason.length > 0 : false).toBe(true);
      expect(result.kind === "refused" ? result.commands.length > 0 : false).toBe(true);
    }
  });

  /** Nothing this command does to a foreign install depends on the registry. */
  it("still explains a foreign install when the registry is unreachable", () => {
    expect(plan({ kind: "docker" }, { latest: null }).kind).toBe("refused");
  });
});

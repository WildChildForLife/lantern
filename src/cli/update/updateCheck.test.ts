import { describe, expect, it } from "vitest";
import {
  isUpdateNotifierSilenced,
  shouldCheckForUpdate,
  UPDATE_CHECK_INTERVAL_MS,
  updateNotice,
  type UpdateCheckContext,
  wantsUpdateCheck,
} from "./updateCheck.ts";

const NOW = 1_760_000_000_000;

const base: UpdateCheckContext = {
  isInteractive: true,
  env: {},
  configOptOut: false,
  installSource: "npm-global",
  lastCheckedAt: null,
  now: NOW,
  intervalMs: UPDATE_CHECK_INTERVAL_MS,
};

describe("shouldCheckForUpdate", () => {
  it("asks on a first launch at a terminal", () => {
    expect(shouldCheckForUpdate(base)).toBe(true);
  });

  it("asks again once a day has passed, and not before", () => {
    expect(
      shouldCheckForUpdate({ ...base, lastCheckedAt: NOW - UPDATE_CHECK_INTERVAL_MS + 1 }),
    ).toBe(false);
    expect(shouldCheckForUpdate({ ...base, lastCheckedAt: NOW - UPDATE_CHECK_INTERVAL_MS })).toBe(
      true,
    );
  });

  /** A restored backup or a clock put back must not wedge the check forever. */
  it("asks again when the last check is in the future", () => {
    expect(shouldCheckForUpdate({ ...base, lastCheckedAt: NOW + 60_000 })).toBe(true);
  });

  it("never asks without a terminal", () => {
    expect(shouldCheckForUpdate({ ...base, isInteractive: false })).toBe(false);
  });

  it("obeys the settings file", () => {
    expect(shouldCheckForUpdate({ ...base, configOptOut: true })).toBe(false);
  });

  it("obeys CI and both opt-out variables", () => {
    for (const key of ["CI", "NO_UPDATE_NOTIFIER", "LANTERN_NO_UPDATE_NOTIFIER"]) {
      expect(shouldCheckForUpdate({ ...base, env: { [key]: "1" } })).toBe(false);
    }
  });

  /** `NO_UPDATE_NOTIFIER=` is how a shell unsets it, not how it says yes. */
  it("treats an empty variable as unset", () => {
    expect(shouldCheckForUpdate({ ...base, env: { NO_UPDATE_NOTIFIER: "" } })).toBe(true);
  });

  /**
   * Nobody who cannot act on the answer should be paying for the request, and
   * a container asking npm about a package it did not install is pure noise.
   */
  it("only asks for installs that could take the upgrade", () => {
    const asked = ["npm-global", "homebrew", "unknown"] as const;
    const quiet = ["docker", "system-package", "npx-cache", "git-checkout"] as const;

    for (const installSource of asked) {
      expect(shouldCheckForUpdate({ ...base, installSource })).toBe(true);
    }
    for (const installSource of quiet) {
      expect(shouldCheckForUpdate({ ...base, installSource })).toBe(false);
    }
  });
});

describe("isUpdateNotifierSilenced", () => {
  const notifier = {
    isInteractive: base.isInteractive,
    env: base.env,
    configOptOut: base.configOptOut,
    installSource: base.installSource,
  };

  it("says nothing where it would not be read", () => {
    expect(isUpdateNotifierSilenced({ ...notifier, isInteractive: false })).toBe(true);
    expect(isUpdateNotifierSilenced({ ...notifier, installSource: "docker" })).toBe(true);
  });

  /**
   * The notice and the request behind it have to agree. Silencing one and not
   * the other would print yesterday's answer to somebody who asked Lantern to
   * stop talking about versions.
   */
  it("silences the notice with the same switches that stop the request", () => {
    for (const key of ["CI", "NO_UPDATE_NOTIFIER", "LANTERN_NO_UPDATE_NOTIFIER"]) {
      expect(isUpdateNotifierSilenced({ ...notifier, env: { [key]: "1" } })).toBe(true);
      expect(shouldCheckForUpdate({ ...base, env: { [key]: "1" } })).toBe(false);
    }

    expect(isUpdateNotifierSilenced({ ...notifier, configOptOut: true })).toBe(true);
  });

  it("stays out of the way on an ordinary launch", () => {
    expect(isUpdateNotifierSilenced(notifier)).toBe(false);
  });
});

describe("updateNotice", () => {
  it("names both versions and how to take the upgrade", () => {
    expect(updateNotice("0.3.0", "0.4.0", "npm-global")).toBe(
      "Lantern 0.4.0 is available (you have 0.3.0). Run `lantern upgrade`.",
    );
  });

  it("points a Homebrew install at brew", () => {
    expect(updateNotice("0.3.0", "0.4.0", "homebrew")).toContain("brew upgrade lantern-viewer");
  });

  it("says nothing when there is nothing to say", () => {
    expect(updateNotice("0.3.0", null, "npm-global")).toBeNull();
    expect(updateNotice("0.3.0", "0.3.0", "npm-global")).toBeNull();
    expect(updateNotice("0.4.0", "0.3.0", "npm-global")).toBeNull();
  });

  it("does not nag an install that cannot act on it", () => {
    expect(updateNotice("0.3.0", "0.4.0", "docker")).toBeNull();
    expect(updateNotice("0.3.0", "0.4.0", "system-package")).toBeNull();
  });

  /** A beta on the `latest` tag is not an upgrade for a release install. */
  it("never offers a prerelease to a stable install", () => {
    expect(updateNotice("0.3.0", "0.4.0-beta.1", "npm-global")).toBeNull();
  });
});

describe("wantsUpdateCheck", () => {
  const argv = (...args: string[]): string[] => ["node", "/usr/local/bin/lantern", ...args];

  it("runs alongside the commands that stay up", () => {
    expect(wantsUpdateCheck(argv())).toBe(true);
    expect(wantsUpdateCheck(argv("browse"))).toBe(true);
    expect(wantsUpdateCheck(argv("b"))).toBe(true);
    expect(wantsUpdateCheck(argv("--port", "3400"))).toBe(true);
  });

  /**
   * An in-flight request holds the event loop open, so a command that prints
   * one line and stops would sit there waiting on it.
   */
  it("stays out of commands that print and exit", () => {
    expect(wantsUpdateCheck(argv("--version"))).toBe(false);
    expect(wantsUpdateCheck(argv("--help"))).toBe(false);
    expect(wantsUpdateCheck(argv("upgrade"))).toBe(false);
    expect(wantsUpdateCheck(argv("init"))).toBe(false);
  });

  /** `--port 3400` is the root command, and 3400 is not a subcommand. */
  it("does not read an option's value as a command", () => {
    expect(wantsUpdateCheck(argv("--hostname", "0.0.0.0"))).toBe(true);
  });
});

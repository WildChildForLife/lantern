import { describe, expect, it } from "vitest";
import { isUpgrade, parseVersion } from "./semver.ts";

describe("parseVersion", () => {
  it("reads a release and a prerelease", () => {
    expect(parseVersion("0.3.0")).toEqual({ major: 0, minor: 3, patch: 0, prerelease: null });
    expect(parseVersion("1.2.3-beta.10")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: "beta.10",
    });
  });

  it("refuses what it cannot read", () => {
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("latest")).toBeNull();
    expect(parseVersion("1.2")).toBeNull();
  });
});

describe("isUpgrade", () => {
  it("compares numerically, not as text", () => {
    expect(isUpgrade("0.9.0", "0.10.0")).toBe(true);
    expect(isUpgrade("0.10.0", "0.9.0")).toBe(false);
    expect(isUpgrade("1.0.0", "1.0.1")).toBe(true);
  });

  it("is not an upgrade to the version already installed", () => {
    expect(isUpgrade("0.3.0", "0.3.0")).toBe(false);
  });

  /**
   * The one that matters: a beta published to the `latest` tag must never be
   * offered to somebody running a release.
   */
  it("never offers a prerelease to a stable install", () => {
    expect(isUpgrade("0.3.0", "0.4.0-beta.1")).toBe(false);
    expect(isUpgrade("0.3.0", "1.0.0-rc.1")).toBe(false);
  });

  it("offers a newer prerelease to somebody already on one", () => {
    expect(isUpgrade("0.4.0-beta.1", "0.4.0-beta.2")).toBe(true);
    expect(isUpgrade("0.4.0-beta.2", "0.4.0-beta.1")).toBe(false);
    expect(isUpgrade("0.4.0-beta.1", "0.5.0-beta.1")).toBe(true);
  });

  /** A release always beats the prerelease of the same version. */
  it("offers the release to somebody on its prerelease", () => {
    expect(isUpgrade("0.4.0-beta.1", "0.4.0")).toBe(true);
    expect(isUpgrade("0.4.0", "0.4.0-beta.1")).toBe(false);
  });

  it("orders prerelease identifiers the way semver does", () => {
    expect(isUpgrade("1.0.0-alpha.1", "1.0.0-alpha.2")).toBe(true);
    expect(isUpgrade("1.0.0-alpha.9", "1.0.0-alpha.10")).toBe(true);
    expect(isUpgrade("1.0.0-alpha", "1.0.0-beta")).toBe(true);
    expect(isUpgrade("1.0.0-beta", "1.0.0-alpha")).toBe(false);
  });

  it("stays quiet when either version cannot be read", () => {
    expect(isUpgrade("not-a-version", "0.4.0")).toBe(false);
    expect(isUpgrade("0.3.0", "not-a-version")).toBe(false);
  });
});

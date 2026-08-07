import { describe, expect, it } from "vitest";
import { describeMissingDirectory } from "./describeMissingDirectory.ts";

describe("describeMissingDirectory", () => {
  it("says a deleted directory is gone", () => {
    expect(describeMissingDirectory("/home/dev/orders-api", "linux")).toContain("no longer exists");
  });

  it("explains why the directory matters at all", () => {
    expect(describeMissingDirectory("/home/dev/orders-api", "linux")).toContain(
      "directory it ran in",
    );
  });

  /**
   * Reading a Windows Claude Code's history from Linux is a supported setup, and
   * those conversations carry paths this host never had. "No longer exists"
   * would send the user looking for something they never lost.
   */
  it.each(["C:\\Users\\you\\project", "c:/Users/you/project", "\\\\WSL$\\Ubuntu\\root"])(
    "says %s belongs to another machine",
    (path) => {
      expect(describeMissingDirectory(path, "linux")).toContain("another machine");
    },
  );

  it("treats a Windows path as ordinary when running on Windows", () => {
    expect(describeMissingDirectory("C:\\Users\\you\\project", "win32")).toContain(
      "no longer exists",
    );
  });
});

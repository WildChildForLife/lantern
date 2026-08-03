import { describe, expect, it } from "vitest";
import { canonicalizeProjectPath } from "./canonicalizeProjectPath.ts";

describe("canonicalizeProjectPath", () => {
  it("leaves a plain absolute path alone", () => {
    expect(canonicalizeProjectPath("/home/demo/api")).toBe("/home/demo/api");
  });

  it("drops a trailing slash", () => {
    expect(canonicalizeProjectPath("/home/demo/api/")).toBe("/home/demo/api");
  });

  it("collapses . and .. segments", () => {
    expect(canonicalizeProjectPath("/home/demo/../demo/./api")).toBe("/home/demo/api");
  });

  it("expands a leading tilde when a home directory is known", () => {
    expect(canonicalizeProjectPath("~/api", { homeDirectory: "/home/demo" })).toBe(
      "/home/demo/api",
    );
  });

  it("leaves a tilde alone when no home directory is known", () => {
    expect(canonicalizeProjectPath("~/api")).toBe("~/api");
  });

  it("groups two spellings of one repo together", () => {
    expect(canonicalizeProjectPath("/home/demo/api/")).toBe(
      canonicalizeProjectPath("/home/demo/tools/../api"),
    );
  });

  it("keeps case on a case-sensitive platform", () => {
    expect(canonicalizeProjectPath("/home/Demo/API", { platform: "linux" })).toBe("/home/Demo/API");
  });

  it("folds case on macOS, where the filesystem does too", () => {
    expect(canonicalizeProjectPath("/Users/Demo/API", { platform: "darwin" })).toBe(
      "/users/demo/api",
    );
  });

  it("normalises a Windows path to posix separators and a lowercase drive", () => {
    expect(canonicalizeProjectPath("C:\\Users\\Demo\\Api", { platform: "win32" })).toBe(
      "c:/users/demo/api",
    );
  });

  it("returns null for nothing usable", () => {
    expect(canonicalizeProjectPath(null)).toBeNull();
    expect(canonicalizeProjectPath("")).toBeNull();
    expect(canonicalizeProjectPath("   ")).toBeNull();
  });

  it("keeps the filesystem root as a root", () => {
    expect(canonicalizeProjectPath("/")).toBe("/");
  });
});

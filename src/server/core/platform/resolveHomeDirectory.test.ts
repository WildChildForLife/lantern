import { describe, expect, it } from "vitest";
import { resolveHomeDirectory } from "./resolveHomeDirectory.ts";

describe("resolveHomeDirectory", () => {
  it("uses HOME on platforms that set it", () => {
    expect(resolveHomeDirectory("/home/ada", undefined)).toBe("/home/ada");
  });

  it("falls back to USERPROFILE when HOME is unset", () => {
    // Native Windows: cmd and PowerShell set USERPROFILE only, so reading HOME
    // alone left the home directory unresolved.
    expect(resolveHomeDirectory(undefined, "C:\\Users\\Ada")).toBe("C:\\Users\\Ada");
  });

  it("prefers HOME when both are set", () => {
    // Git Bash and WSL set both; HOME is the one the user's tooling agrees on.
    expect(resolveHomeDirectory("/home/ada", "C:\\Users\\Ada")).toBe("/home/ada");
  });

  it("treats an empty value as unset", () => {
    expect(resolveHomeDirectory("", "C:\\Users\\Ada")).toBe("C:\\Users\\Ada");
    expect(resolveHomeDirectory("", "")).toBeUndefined();
  });

  it("is undefined when neither is set", () => {
    expect(resolveHomeDirectory(undefined, undefined)).toBeUndefined();
  });
});

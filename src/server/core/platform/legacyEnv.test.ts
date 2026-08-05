import { describe, expect, it } from "vitest";
import { LEGACY_ENV_ALIASES, withLegacyEnvAliases } from "./legacyEnv.ts";

describe("withLegacyEnvAliases", () => {
  it("copies a legacy variable onto its current name", () => {
    expect(withLegacyEnvAliases({ CCV_PASSWORD: "hunter2" }).LANTERN_PASSWORD).toBe("hunter2");
  });

  it("leaves a current name that is already set alone", () => {
    const resolved = withLegacyEnvAliases({
      CCV_PASSWORD: "legacy",
      LANTERN_PASSWORD: "current",
    });

    expect(resolved.LANTERN_PASSWORD).toBe("current");
  });

  it("keeps the legacy entry so nothing downstream sees it disappear", () => {
    expect(withLegacyEnvAliases({ CCV_ENV: "production" }).CCV_ENV).toBe("production");
  });

  it("does not mutate the input", () => {
    const env = { CCV_TERMINAL_DISABLED: "1" };
    withLegacyEnvAliases(env);

    expect(env).toStrictEqual({ CCV_TERMINAL_DISABLED: "1" });
  });

  it("maps every alias onto a LANTERN_ name", () => {
    for (const [legacyKey, currentKey] of Object.entries(LEGACY_ENV_ALIASES)) {
      expect(legacyKey.startsWith("CCV_")).toBe(true);
      expect(currentKey.startsWith("LANTERN_")).toBe(true);
    }
  });
});

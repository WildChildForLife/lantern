import { it } from "@effect/vitest";
/* oxlint-disable node/no-process-env -- testing environment variable detection */
import { Effect } from "effect";
import { beforeEach, describe, expect, vi } from "vitest";

describe("DeprecatedEnvDetector", () => {
  beforeEach(() => {
    vi.resetModules();
    // biome-ignore lint/style/noProcessEnv: Testing environment variable detection
    delete process.env.CCV_PASSWORD;
    // biome-ignore lint/style/noProcessEnv: Testing environment variable detection
    delete process.env.CCV_TERMINAL_DISABLED;
    // biome-ignore lint/style/noProcessEnv: Testing environment variable detection
    delete process.env.LANTERN_PASSWORD;
  });

  it.live("stays quiet when only current variable names are set", () =>
    Effect.gen(function* () {
      const consoleSpy = vi.spyOn(console, "log");

      // biome-ignore lint/style/noProcessEnv: Testing environment variable detection
      process.env.LANTERN_PASSWORD = "test";

      const { checkDeprecatedEnvs } = yield* Effect.promise(
        () => import("./DeprecatedEnvDetector.ts"),
      );

      yield* checkDeprecatedEnvs;

      expect(consoleSpy).not.toHaveBeenCalled();

      // biome-ignore lint/style/noProcessEnv: Testing environment variable detection
      delete process.env.LANTERN_PASSWORD;
    }),
  );

  it.live("names the replacement for a renamed variable without failing", () =>
    Effect.gen(function* () {
      const consoleSpy = vi.spyOn(console, "log");

      // biome-ignore lint/style/noProcessEnv: Testing environment variable detection
      process.env.CCV_PASSWORD = "test";

      const { checkDeprecatedEnvs } = yield* Effect.promise(
        () => import("./DeprecatedEnvDetector.ts"),
      );

      yield* checkDeprecatedEnvs;

      const output = consoleSpy.mock.calls.flat().join("\n");
      expect(output).toContain("DEPRECATED");
      expect(output).toContain("CCV_PASSWORD");
      expect(output).toContain("LANTERN_PASSWORD");

      // biome-ignore lint/style/noProcessEnv: Testing environment variable detection
      delete process.env.CCV_PASSWORD;
    }),
  );

  it.live("reports every renamed variable that is still set", () =>
    Effect.gen(function* () {
      const consoleSpy = vi.spyOn(console, "log");

      // biome-ignore lint/style/noProcessEnv: Testing environment variable detection
      process.env.CCV_PASSWORD = "test";
      // biome-ignore lint/style/noProcessEnv: Testing environment variable detection
      process.env.CCV_TERMINAL_DISABLED = "1";

      const { checkDeprecatedEnvs } = yield* Effect.promise(
        () => import("./DeprecatedEnvDetector.ts"),
      );

      yield* checkDeprecatedEnvs;

      const output = consoleSpy.mock.calls.flat().join("\n");
      expect(output).toContain("CCV_PASSWORD");
      expect(output).toContain("CCV_TERMINAL_DISABLED");
      expect(output).toContain("https://github.com/WildChildForLife/lantern#configuration");

      // biome-ignore lint/style/noProcessEnv: Testing environment variable detection
      delete process.env.CCV_PASSWORD;
      // biome-ignore lint/style/noProcessEnv: Testing environment variable detection
      delete process.env.CCV_TERMINAL_DISABLED;
    }),
  );
});

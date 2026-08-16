import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";
import { runUpgradeCommand } from "./runUpgradeCommand.ts";

describe("runUpgradeCommand", () => {
  /**
   * The exit code is the whole report: the package manager's output went
   * straight to the terminal, so this is the only thing Lantern learns from it.
   */
  it.live("waits for the package manager and reports how it ended", () =>
    Effect.promise(async () => {
      expect(await runUpgradeCommand("sh", ["-c", "exit 0"])).toBe(0);
      expect(await runUpgradeCommand("sh", ["-c", "exit 3"])).toBe(3);
    }),
  );

  it.live("comes back with a code when the package manager is not there at all", () =>
    Effect.promise(async () => {
      expect(await runUpgradeCommand("lantern-no-such-package-manager", [])).toBe(127);
    }),
  );
});

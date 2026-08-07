import { describe, expect, it } from "vitest";
import { shouldRunWizard } from "./firstRun.ts";

const base = { configExists: false, isInteractive: true, noInit: false, env: {} };

describe("shouldRunWizard", () => {
  it("offers itself on a first launch at a terminal", () => {
    expect(shouldRunWizard(base)).toBe(true);
  });

  it("stays out of the way once settings exist", () => {
    expect(shouldRunWizard({ ...base, configExists: true })).toBe(false);
  });

  /**
   * Docker, systemd and `npx ... | tee` all land here. A prompt with nothing
   * attached to answer it would hang the container instead of starting it.
   */
  it("never prompts without a terminal", () => {
    expect(shouldRunWizard({ ...base, isInteractive: false })).toBe(false);
  });

  it("never prompts in CI", () => {
    expect(shouldRunWizard({ ...base, env: { CI: "true" } })).toBe(false);
    expect(shouldRunWizard({ ...base, env: { CI: "1" } })).toBe(false);
  });

  /** `CI=` is how a shell unsets it, not how it says yes. */
  it("treats an empty CI variable as not CI", () => {
    expect(shouldRunWizard({ ...base, env: { CI: "" } })).toBe(true);
  });

  it("obeys --no-init", () => {
    expect(shouldRunWizard({ ...base, noInit: true })).toBe(false);
  });

  it("obeys LANTERN_NO_INIT", () => {
    expect(shouldRunWizard({ ...base, env: { LANTERN_NO_INIT: "1" } })).toBe(false);
  });
});

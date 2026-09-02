import { describe, expect, it } from "vitest";
import { describeUnreadableSettings } from "./describeUnreadableSettings.ts";

describe("describeUnreadableSettings", () => {
  it("names the file, so the reader knows which one to open", () => {
    const message = describeUnreadableSettings("/root/.lantern/config.json");

    expect(message).toContain("/root/.lantern/config.json");
  });

  /** Nothing stopped; the reader needs to know their settings were dropped. */
  it("says what happened instead of stopping", () => {
    const message = describeUnreadableSettings("/root/.lantern/config.json");

    expect(message).toContain("defaults");
  });

  it("says how to get back to a working file", () => {
    const message = describeUnreadableSettings("/root/.lantern/config.json");

    expect(message).toContain("Deleting it");
  });

  /**
   * Both ways in reach this message, and naming only one would send half the
   * readers looking in the wrong place.
   */
  it("does not blame the JSON, which is only one of the two ways here", () => {
    const message = describeUnreadableSettings("/root/.lantern/config.json");

    expect(message).toContain("not allowed to");
    expect(message).not.toMatch(/^Fix the JSON/mu);
  });

  /** The raw log frame this replaced read as a crash. This is not one. */
  it("reads as a notice rather than a failure", () => {
    const message = describeUnreadableSettings("/root/.lantern/config.json").toLowerCase();

    expect(message).not.toContain("error");
    expect(message).not.toContain("warn");
    expect(message).not.toContain("fiber");
  });
});

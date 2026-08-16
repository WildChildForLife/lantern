import { describe, expect, it } from "vitest";
import { parseLatestVersionResponse } from "./latestVersion.ts";

describe("parseLatestVersionResponse", () => {
  it("reads the version off the abbreviated packument", () => {
    expect(parseLatestVersionResponse({ name: "lantern-viewer", version: "0.4.0" })).toBe("0.4.0");
  });

  /**
   * A registry error page, an HTML captive portal, a proxy's JSON: none of them
   * are an answer, and treating one as a version would offer an upgrade to
   * something that does not exist.
   */
  it("treats anything else as no answer at all", () => {
    expect(parseLatestVersionResponse({ error: "Not found" })).toBeNull();
    expect(parseLatestVersionResponse({ version: 4 })).toBeNull();
    expect(parseLatestVersionResponse("0.4.0")).toBeNull();
    expect(parseLatestVersionResponse(null)).toBeNull();
  });
});

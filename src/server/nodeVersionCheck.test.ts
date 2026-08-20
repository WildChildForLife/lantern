import { describe, expect, it } from "vitest";
import { describeOutdatedNode } from "./nodeVersionCheck.ts";

describe("describeOutdatedNode", () => {
  it("has nothing to say about a version new enough to run on", () => {
    expect(describeOutdatedNode("v24.0.0")).toBe(null);
    expect(describeOutdatedNode("v25.1.2")).toBe(null);
  });

  it("says what is needed and what is here, without the word `error`", () => {
    const message = describeOutdatedNode("v22.22.0");

    expect(message).not.toContain("Error");
    expect(message).toContain("Node.js 24");
    expect(message).toContain("v22.22.0");
  });

  /**
   * The reader's next move is installing one, and the answer differs by how
   * they got Node in the first place — so both routes are printed.
   */
  it("offers a way out rather than only a requirement", () => {
    const message = describeOutdatedNode("v20.0.0");

    expect(message).toContain("nvm");
    expect(message).toContain("nodejs.org");
  });

  /** `process.version` is always prefixed, but nothing here should depend on it. */
  it("reads a version with or without the leading v", () => {
    expect(describeOutdatedNode("22.22.0")).toContain("22.22.0");
    expect(describeOutdatedNode("24.0.0")).toBe(null);
  });

  /** An unreadable version is not a reason to refuse to start. */
  it("says nothing about a version it cannot read", () => {
    expect(describeOutdatedNode("not-a-version")).toBe(null);
  });
});

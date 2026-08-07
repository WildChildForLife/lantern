import { describe, expect, it } from "vitest";
import { truncateToWidth } from "./formatRow.ts";

describe("truncateToWidth", () => {
  it("leaves text that already fits alone", () => {
    expect(truncateToWidth("Orders API", 20)).toBe("Orders API");
  });

  it("clips with an ellipsis so the column never overflows", () => {
    const clipped = truncateToWidth("Fix the checkout flow for refunds", 12);

    expect(clipped).toHaveLength(12);
    expect(clipped.endsWith("…")).toBe(true);
  });

  it("copes with a width of one", () => {
    expect(truncateToWidth("anything", 1)).toBe("…");
  });

  it("returns nothing for a width of zero or less", () => {
    expect(truncateToWidth("anything", 0)).toBe("");
    expect(truncateToWidth("anything", -5)).toBe("");
  });

  /** A clipped title must not end mid-emoji and leave a half-character. */
  it("clips by code point, not by UTF-16 unit", () => {
    expect(Array.from(truncateToWidth("🎉🎉🎉🎉🎉", 3))).toHaveLength(3);
  });
});

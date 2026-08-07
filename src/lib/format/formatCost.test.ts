import { describe, expect, it } from "vitest";
import { formatCost, UNKNOWN_COST_PLACEHOLDER } from "./formatCost.ts";

describe("formatCost", () => {
  it("marks a computed figure as an estimate", () => {
    expect(formatCost(1.234, "estimated")).toBe("~$1.23");
  });

  it("shows a cost the provider reported without a qualifier", () => {
    expect(formatCost(1.234, "reported")).toBe("$1.23");
  });

  /** $0.00 would read as free, which is a claim this build cannot make. */
  it("never renders an unpriced session as zero", () => {
    expect(formatCost(0, "unknown")).toBe(UNKNOWN_COST_PLACEHOLDER);
    expect(formatCost(12.5, "unknown")).toBe(UNKNOWN_COST_PLACEHOLDER);
  });

  it("honours a requested precision", () => {
    expect(formatCost(1.2345, "estimated", { fractionDigits: 3 })).toBe("~$1.234");
  });

  it("still shows a genuine zero when the price is known", () => {
    expect(formatCost(0, "estimated")).toBe("~$0.00");
  });

  /** A value from a newer build must not be rendered as money. */
  it("falls back to the placeholder for a confidence it does not recognise", () => {
    expect(formatCost(9.99, "something-new")).toBe(UNKNOWN_COST_PLACEHOLDER);
  });
});

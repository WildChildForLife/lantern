import { describe, expect, it } from "vitest";
import { highlightSpans, truncateToWidth } from "./formatRow.ts";

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

describe("highlightSpans", () => {
  const rejoined = (segments: { text: string }[]): string =>
    segments.map((segment) => segment.text).join("");

  /** No search running is the common case, and it has to cost the row nothing. */
  it("returns the whole title as one piece when nothing matched", () => {
    expect(highlightSpans("Add refunds", [], 40)).toStrictEqual([
      { text: "Add refunds", matched: false },
    ]);
  });

  it("picks out the part that matched", () => {
    expect(highlightSpans("Add refunds", [{ start: 4, end: 10 }], 40)).toStrictEqual([
      { text: "Add ", matched: false },
      { text: "refund", matched: true },
      { text: "s", matched: false },
    ]);
  });

  it("starts on a match without an empty piece in front of it", () => {
    expect(highlightSpans("refunds", [{ start: 0, end: 6 }], 40)).toStrictEqual([
      { text: "refund", matched: true },
      { text: "s", matched: false },
    ]);
  });

  it("picks out several matches", () => {
    expect(
      highlightSpans(
        "board layout",
        [
          { start: 0, end: 2 },
          { start: 6, end: 8 },
        ],
        40,
      ),
    ).toStrictEqual([
      { text: "bo", matched: true },
      { text: "ard ", matched: false },
      { text: "la", matched: true },
      { text: "yout", matched: false },
    ]);
  });

  it("joins two matches that meet rather than splitting the run", () => {
    expect(
      highlightSpans(
        "refund",
        [
          { start: 0, end: 3 },
          { start: 3, end: 6 },
        ],
        40,
      ),
    ).toStrictEqual([{ text: "refund", matched: true }]);
  });

  /** The clipped title is what the column draws, so it is what the spans index. */
  it("draws exactly what truncation left", () => {
    const segments = highlightSpans(
      "Fix the checkout flow for refunds",
      [{ start: 4, end: 7 }],
      12,
    );

    expect(rejoined(segments)).toBe(truncateToWidth("Fix the checkout flow for refunds", 12));
  });

  it("keeps the part of a match that survived the clip", () => {
    expect(highlightSpans("Fix the checkout", [{ start: 8, end: 16 }], 12)).toStrictEqual([
      { text: "Fix the ", matched: false },
      { text: "che", matched: true },
      { text: "…", matched: false },
    ]);
  });

  /** The ellipsis stands for what was dropped, so it can never be a match. */
  it("never marks the ellipsis as a match", () => {
    const segments = highlightSpans("Fix the checkout", [{ start: 14, end: 16 }], 12);

    expect(segments).toStrictEqual([{ text: "Fix the che…", matched: false }]);
  });

  it("counts positions in characters, not UTF-16 units", () => {
    expect(highlightSpans("🎉 refund", [{ start: 2, end: 8 }], 40)).toStrictEqual([
      { text: "🎉 ", matched: false },
      { text: "refund", matched: true },
    ]);
  });

  it("has nothing to draw at a width of zero", () => {
    expect(highlightSpans("Add refunds", [{ start: 0, end: 3 }], 0)).toStrictEqual([]);
  });
});

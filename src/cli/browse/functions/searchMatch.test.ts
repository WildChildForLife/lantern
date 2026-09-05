import { describe, expect, it } from "vitest";
import { mergeSpans, parseQuery, scoreMatch } from "./searchMatch.ts";

const score = (haystack: string, term: string, caseSensitive = false): number =>
  scoreMatch(haystack, term, caseSensitive)?.score ?? Number.NEGATIVE_INFINITY;

describe("parseQuery", () => {
  it("splits the query into terms that all have to match", () => {
    expect(parseQuery("refund flow").terms).toStrictEqual(["refund", "flow"]);
  });

  it("ignores the spacing between terms", () => {
    expect(parseQuery("  refund   flow  ").terms).toStrictEqual(["refund", "flow"]);
  });

  it("has no terms for an empty query", () => {
    expect(parseQuery("   ").terms).toStrictEqual([]);
  });

  /**
   * Smart case: a query typed in lower case is asking for anything, and one with
   * a capital in it is asking for that capital. Nobody reaches for a case switch
   * on a one-line search bar, and holding shift is the gesture they already make.
   */
  it("ignores case until the query mixes it", () => {
    expect(parseQuery("refund").caseSensitive).toBe(false);
    expect(parseQuery("Refund").caseSensitive).toBe(true);
    expect(parseQuery("fix API").caseSensitive).toBe(true);
  });

  /** `API` is how the word is spelled, not a demand that the rows spell it so. */
  it("does not switch on a query typed all in capitals", () => {
    expect(parseQuery("API").caseSensitive).toBe(false);
    expect(parseQuery("ORDERS API").caseSensitive).toBe(false);
  });

  it("does not read a digit or a symbol as a capital", () => {
    expect(parseQuery("fix-404").caseSensitive).toBe(false);
  });
});

describe("mergeSpans", () => {
  it("puts the spans in the order they appear", () => {
    expect(
      mergeSpans([
        { start: 8, end: 10 },
        { start: 0, end: 3 },
      ]),
    ).toStrictEqual([
      { start: 0, end: 3 },
      { start: 8, end: 10 },
    ]);
  });

  it("folds two terms that landed on the same characters into one span", () => {
    expect(
      mergeSpans([
        { start: 0, end: 6 },
        { start: 3, end: 9 },
      ]),
    ).toStrictEqual([{ start: 0, end: 9 }]);
  });

  it("joins spans that meet without leaving a seam", () => {
    expect(
      mergeSpans([
        { start: 0, end: 3 },
        { start: 3, end: 6 },
      ]),
    ).toStrictEqual([{ start: 0, end: 6 }]);
  });

  it("leaves a span that swallows another alone", () => {
    expect(
      mergeSpans([
        { start: 0, end: 10 },
        { start: 3, end: 5 },
      ]),
    ).toStrictEqual([{ start: 0, end: 10 }]);
  });

  it("has nothing to merge in nothing", () => {
    expect(mergeSpans([])).toStrictEqual([]);
  });
});

describe("scoreMatch", () => {
  it("finds a whole word", () => {
    expect(scoreMatch("Add refunds to checkout", "refunds")).not.toBeNull();
  });

  it("says so when there is no match", () => {
    expect(scoreMatch("Add refunds to checkout", "dhcp")).toBeNull();
  });

  it("matches without regard to case by default", () => {
    expect(scoreMatch("Orders API", "orders")).not.toBeNull();
  });

  it("holds the case against it when asked to", () => {
    expect(scoreMatch("Orders API", "orders", true)).toBeNull();
    expect(scoreMatch("Orders API", "Orders", true)).not.toBeNull();
  });

  /** The point of a fuzzy search: initials find the thing they are initials of. */
  it("matches characters spread through the text", () => {
    expect(scoreMatch("Router DHCP lease renewal", "rdlr")).not.toBeNull();
  });

  it("keeps the characters in the order they were typed", () => {
    expect(scoreMatch("Router DHCP", "pchd")).toBeNull();
  });

  it("reports where it matched, so the row can show it", () => {
    expect(scoreMatch("Add refunds", "refund")?.spans).toStrictEqual([{ start: 4, end: 10 }]);
  });

  it("reports every run of a scattered match", () => {
    expect(scoreMatch("board layout", "bola")?.spans).toStrictEqual([
      { start: 0, end: 2 },
      { start: 6, end: 8 },
    ]);
  });

  it("counts positions in characters, not UTF-16 units", () => {
    expect(scoreMatch("🎉 refund", "refund")?.spans).toStrictEqual([{ start: 2, end: 8 }]);
  });

  describe("ranking", () => {
    it("prefers a whole word over the same letters scattered", () => {
      expect(score("Add refunds", "refund")).toBeGreaterThan(score("really funny door", "refund"));
    });

    it("prefers a match at the start of the text", () => {
      expect(score("refund the order", "refund")).toBeGreaterThan(
        score("order the refund", "refund"),
      );
    });

    it("prefers a match at the start of a word over one inside one", () => {
      expect(score("fix the refund flow", "refund")).toBeGreaterThan(
        score("prerefundable", "refund"),
      );
    });

    it("prefers the tighter of two scattered matches", () => {
      expect(score("board layout", "bola")).toBeGreaterThan(
        score("b in a very long assortment of labels", "bola"),
      );
    });

    it("reads a capital in the middle of a word as the start of one", () => {
      expect(score("fixAuthBug", "auth")).toBeGreaterThan(score("xxauthxx", "auth"));
    });

    it("prefers a path segment boundary over the middle of a word", () => {
      expect(score("/home/dev/lantern", "lantern")).toBeGreaterThan(
        score("xxlanternxx", "lantern"),
      );
    });
  });

  describe("edge cases", () => {
    it("matches everything against an empty term", () => {
      expect(scoreMatch("anything", "")).not.toBeNull();
    });

    it("finds nothing in empty text", () => {
      expect(scoreMatch("", "refund")).toBeNull();
    });

    it("never scores a match at or below nothing", () => {
      const worst = scoreMatch(`${"z".repeat(200)}refund`, "refund");

      expect(worst?.score).toBeGreaterThan(0);
    });
  });
});

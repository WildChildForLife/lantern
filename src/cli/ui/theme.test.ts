import { describe, expect, it } from "vitest";
import { FALLBACK_GLYPH, KNOWN_TOPIC_ICONS, topicColor, topicGlyph } from "./theme.ts";

describe("topicGlyph", () => {
  /**
   * The grouping code owns the icon names; this keeps the terminal from
   * quietly degrading to bullets when a new one is added there.
   */
  it("has a glyph for every icon a topic can carry", () => {
    const missing = KNOWN_TOPIC_ICONS.filter((icon) => topicGlyph(icon) === FALLBACK_GLYPH);

    expect(missing).toStrictEqual([]);
  });

  it("falls back rather than rendering nothing for an unknown icon", () => {
    expect(topicGlyph("dragon")).toBe(FALLBACK_GLYPH);
  });

  it("stays inside one terminal cell", () => {
    for (const icon of KNOWN_TOPIC_ICONS) {
      expect(Array.from(topicGlyph(icon))).toHaveLength(1);
    }
  });
});

describe("topicColor", () => {
  it("gives the same topic the same colour every time", () => {
    expect(topicColor("orders-api")).toBe(topicColor("orders-api"));
  });

  it("spreads topics across the palette rather than picking one", () => {
    const ids = ["api", "network", "docs", "billing", "auth", "deploy", "search", "cache"];

    expect(new Set(ids.map(topicColor)).size).toBeGreaterThan(1);
  });

  it("copes with an empty id", () => {
    expect(topicColor("")).toBeDefined();
  });
});

import { describe, expect, it } from "vitest";
import { normalizeAnthropicModelName } from "../constants/pricing/anthropic.ts";

/**
 * Edge cases for normalizeModelName that are NOT covered by the existing test file.
 * Focus on potential misclassifications and boundary conditions.
 */
describe("normalizeAnthropicModelName - additional edge cases", () => {
  describe("opus-4 without version suffix", () => {
    it("reports 'claude-opus-4' as unpriced rather than guessing", () => {
      // Matches none of the patterns. It used to fall through to Sonnet, which
      // priced an Opus session at roughly a fifth of its real cost.
      expect(normalizeAnthropicModelName("claude-opus-4")).toBeNull();
    });
  });

  describe("haiku-4 without version suffix", () => {
    it("reports 'claude-haiku-4' as unpriced rather than guessing", () => {
      expect(normalizeAnthropicModelName("claude-haiku-4")).toBeNull();
    });
  });

  describe("case insensitivity", () => {
    it("handles UPPERCASE model names (sonnet-4-5)", () => {
      const result = normalizeAnthropicModelName("CLAUDE-SONNET-4-5-20250929");
      expect(result).toBe("claude-sonnet-4.5");
    });

    it("handles mixed case for opus-4-5", () => {
      const result = normalizeAnthropicModelName("Claude-Opus-4-5-20251101");
      expect(result).toBe("claude-opus-4.5");
    });
  });

  describe("claude-3.5-sonnet patterns", () => {
    it("recognizes claude-sonnet-4 (without .5) as claude-3.5-sonnet", () => {
      // "sonnet-4" is matched by the check: normalized.includes("sonnet-4")
      // This maps to claude-3.5-sonnet per the comment: "Sonnet 4 without version suffix"
      const result = normalizeAnthropicModelName("claude-sonnet-4-20250514");
      expect(result).toBe("claude-3.5-sonnet");
    });

    it("recognizes claude-3.5-sonnet with dot", () => {
      const result = normalizeAnthropicModelName("claude-3.5-sonnet-20241022");
      expect(result).toBe("claude-3.5-sonnet");
    });
  });

  describe("model name priority: more specific patterns first", () => {
    it("opus-4-5 takes priority over generic opus-4 check (if it existed)", () => {
      // Ensure sonnet-4-5 does NOT fall into the sonnet-4 bucket (the more specific pattern wins)
      const result = normalizeAnthropicModelName("claude-sonnet-4-5-20250929");
      // Should be claude-sonnet-4.5, NOT claude-3.5-sonnet
      expect(result).toBe("claude-sonnet-4.5");
      expect(result).not.toBe("claude-3.5-sonnet");
    });

    it("haiku-4-5 takes priority and is not treated as haiku-4 (default)", () => {
      const result = normalizeAnthropicModelName("claude-haiku-4-5-20251001");
      expect(result).toBe("claude-haiku-4.5");
      expect(result).not.toBe("claude-3.5-sonnet");
    });
  });

  describe("models with no price here", () => {
    it("returns null for an empty string", () => {
      expect(normalizeAnthropicModelName("")).toBeNull();
    });

    it("returns null for another provider's model", () => {
      expect(normalizeAnthropicModelName("gpt-4-turbo")).toBeNull();
    });

    it("returns null for a partial match that names no model", () => {
      expect(normalizeAnthropicModelName("opus")).toBeNull();
    });
  });
});

import { describe, expect, it } from "vitest";
import { hasRusptyBinary } from "./hasRusptyBinary.ts";

describe("hasRusptyBinary", () => {
  describe("platforms with a published binary", () => {
    it("supports darwin on both architectures", () => {
      expect(hasRusptyBinary("darwin", "x64")).toBe(true);
      expect(hasRusptyBinary("darwin", "arm64")).toBe(true);
    });

    it("supports linux on x64", () => {
      expect(hasRusptyBinary("linux", "x64")).toBe(true);
    });
  });

  describe("platforms with no published binary", () => {
    it("reports linux arm64 as unsupported", () => {
      // The published linux/arm64 container runs here: there is no
      // @replit/ruspty-linux-arm64-gnu package to load.
      expect(hasRusptyBinary("linux", "arm64")).toBe(false);
    });

    it("reports Windows as unsupported", () => {
      expect(hasRusptyBinary("win32", "x64")).toBe(false);
      expect(hasRusptyBinary("win32", "arm64")).toBe(false);
    });

    it("reports other platforms and architectures as unsupported", () => {
      expect(hasRusptyBinary("linux", "arm")).toBe(false);
      expect(hasRusptyBinary("linux", "ppc64")).toBe(false);
      expect(hasRusptyBinary("freebsd", "x64")).toBe(false);
      expect(hasRusptyBinary("darwin", "ia32")).toBe(false);
    });
  });
});

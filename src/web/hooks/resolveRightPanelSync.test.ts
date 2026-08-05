import { describe, expect, it } from "vitest";
import { resolveRightPanelOpenSync, resolveRightPanelTabSync } from "./resolveRightPanelSync";

describe("resolveRightPanelOpenSync", () => {
  describe("when the URL sets rightPanel explicitly", () => {
    it("uses the URL value even if a preference is already stored", () => {
      expect(resolveRightPanelOpenSync(true, true, false)).toEqual({ action: "set", value: true });
      expect(resolveRightPanelOpenSync(false, true, false)).toEqual({
        action: "set",
        value: false,
      });
    });

    it("uses the URL value over the device default", () => {
      expect(resolveRightPanelOpenSync(true, false, true)).toEqual({ action: "set", value: true });
      expect(resolveRightPanelOpenSync(false, false, false)).toEqual({
        action: "set",
        value: false,
      });
    });
  });

  describe("when the URL omits rightPanel and no preference is stored", () => {
    it("opens the panel on PC", () => {
      expect(resolveRightPanelOpenSync(undefined, false, false)).toEqual({
        action: "set",
        value: true,
      });
    });

    it("closes the panel on Mobile", () => {
      expect(resolveRightPanelOpenSync(undefined, false, true)).toEqual({
        action: "set",
        value: false,
      });
    });
  });

  describe("when the URL omits rightPanel and a preference is stored", () => {
    it("keeps the stored preference instead of reapplying the device default", () => {
      expect(resolveRightPanelOpenSync(undefined, true, false)).toEqual({ action: "keep" });
      expect(resolveRightPanelOpenSync(undefined, true, true)).toEqual({ action: "keep" });
    });
  });
});

describe("resolveRightPanelTabSync", () => {
  it("uses the tab named in the URL", () => {
    expect(resolveRightPanelTabSync("git")).toEqual({ action: "set", value: "git" });
  });

  it("keeps the stored tab when the URL omits it", () => {
    expect(resolveRightPanelTabSync(undefined)).toEqual({ action: "keep" });
  });
});

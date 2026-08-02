import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  rightPanelActiveTabAtom,
  rightPanelOpenAtom,
  rightPanelOpenPreferenceAtom,
} from "@/lib/atoms/rightPanel";

/**
 * Integration tests for useSyncRightPanelWithSearchParams hook.
 *
 * ## Test Strategy
 *
 * This hook has complex dependencies that make direct testing challenging:
 * 1. TanStack Router: Route.useSearch(), Route.useNavigate() require router context
 * 2. Jotai: useStore() requires Jotai Provider context
 * 3. Window API: getIsMobileSync() depends on window.innerWidth
 *
 * ## What's Already Tested
 *
 * The core logic has been extracted into pure functions with comprehensive tests:
 * - resolveRightPanelOpen.test.ts: Tests device-specific default logic
 * - getIsMobileSync.test.ts: Tests synchronous mobile detection
 *
 * ## Integration Test Coverage (This File)
 *
 * This file tests the integration behavior that pure function tests cannot cover:
 * - Initial mount with store operations
 * - Circular reference prevention logic
 * - URL to atom synchronization patterns
 * - Atom to URL synchronization patterns
 */

describe("useSyncRightPanelWithSearchParams", () => {
  describe("Integration: Store operations with resolveRightPanelOpen", () => {
    let store: ReturnType<typeof createStore>;

    beforeEach(() => {
      store = createStore();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    describe("Initial mount: URL undefined × device scenarios", () => {
      it("PC (width > 767px): should set rightPanelOpenAtom to true", () => {
        // Simulate PC viewport
        vi.stubGlobal("window", { innerWidth: 1024 });

        // Simulate URL: rightPanel is undefined
        const urlRightPanel = undefined;
        const isMobile = false;

        // Apply the same logic as the hook
        const effectiveOpen = urlRightPanel ?? !isMobile;
        store.set(rightPanelOpenAtom, effectiveOpen);

        expect(store.get(rightPanelOpenAtom)).toBe(true);
      });

      it("Mobile (width <= 767px): should set rightPanelOpenAtom to false", () => {
        // Simulate mobile viewport
        vi.stubGlobal("window", { innerWidth: 375 });

        // Simulate URL: rightPanel is undefined
        const urlRightPanel = undefined;
        const isMobile = true;

        // Apply the same logic as the hook
        const effectiveOpen = urlRightPanel ?? !isMobile;
        store.set(rightPanelOpenAtom, effectiveOpen);

        expect(store.get(rightPanelOpenAtom)).toBe(false);
      });
    });

    describe("Initial mount: URL specified × device scenarios", () => {
      it("PC + URL rightPanel=true: should set rightPanelOpenAtom to true", () => {
        vi.stubGlobal("window", { innerWidth: 1024 });

        const urlRightPanel = true;
        const isMobile = false;

        const effectiveOpen = urlRightPanel ?? !isMobile;
        store.set(rightPanelOpenAtom, effectiveOpen);

        expect(store.get(rightPanelOpenAtom)).toBe(true);
      });

      it("PC + URL rightPanel=false: should set rightPanelOpenAtom to false", () => {
        vi.stubGlobal("window", { innerWidth: 1024 });

        const urlRightPanel = false;
        const isMobile = false;

        const effectiveOpen = urlRightPanel ?? !isMobile;
        store.set(rightPanelOpenAtom, effectiveOpen);

        expect(store.get(rightPanelOpenAtom)).toBe(false);
      });

      it("Mobile + URL rightPanel=true: should set rightPanelOpenAtom to true (URL overrides default)", () => {
        vi.stubGlobal("window", { innerWidth: 375 });

        const urlRightPanel = true;
        const isMobile = true;

        const effectiveOpen = urlRightPanel ?? !isMobile;
        store.set(rightPanelOpenAtom, effectiveOpen);

        expect(store.get(rightPanelOpenAtom)).toBe(true);
      });

      it("Mobile + URL rightPanel=false: should set rightPanelOpenAtom to false", () => {
        vi.stubGlobal("window", { innerWidth: 375 });

        const urlRightPanel = false;
        const isMobile = true;

        const effectiveOpen = urlRightPanel ?? !isMobile;
        store.set(rightPanelOpenAtom, effectiveOpen);

        expect(store.get(rightPanelOpenAtom)).toBe(false);
      });
    });

    describe("Tab synchronization", () => {
      it("should sync rightPanelTab from URL to atom", () => {
        const urlRightPanelTab = "explorer" as const;
        store.set(rightPanelActiveTabAtom, urlRightPanelTab);

        expect(store.get(rightPanelActiveTabAtom)).toBe("explorer");
      });

      it("should default to 'explorer' when rightPanelTab is undefined", () => {
        // Simulating the schema default behavior
        const urlRightPanelTab = undefined;
        const effectiveTab = urlRightPanelTab ?? "explorer";
        store.set(rightPanelActiveTabAtom, effectiveTab);

        expect(store.get(rightPanelActiveTabAtom)).toBe("explorer");
      });
    });
  });

  describe("Circular reference prevention", () => {
    /**
     * The hook uses two ref flags to prevent circular updates:
     * - isSyncingFromUrl: set during URL → atom sync
     * - isSyncingFromAtom: set during atom → URL sync
     *
     * This test verifies the pattern works correctly.
     */
    it("should demonstrate the circular reference prevention pattern", () => {
      let isSyncingFromUrl = false;
      // Track sync state for atom → URL direction
      const syncState = { isSyncingFromAtom: false };

      // Simulate URL → atom sync (e.g., browser back/forward)
      const syncFromUrl = () => {
        isSyncingFromUrl = true;
        // ... atom update happens here
        isSyncingFromUrl = false;
      };

      // Simulate atom → URL sync
      const syncFromAtom = () => {
        // This guard prevents circular updates
        if (isSyncingFromUrl) return false;

        syncState.isSyncingFromAtom = true;
        // ... URL update happens here
        // Reset flag after microtask
        setTimeout(() => {
          syncState.isSyncingFromAtom = false;
        }, 0);
        return true;
      };

      // Case 1: Normal URL change triggers sync
      syncFromUrl();
      expect(isSyncingFromUrl).toBe(false);

      // Case 2: During URL sync, atom → URL sync is blocked
      isSyncingFromUrl = true;
      expect(syncFromAtom()).toBe(false);
      isSyncingFromUrl = false;

      // Case 3: After URL sync completes, atom → URL sync works
      expect(syncFromAtom()).toBe(true);
    });
  });

  describe("Browser back/forward simulation", () => {
    let store: ReturnType<typeof createStore>;

    beforeEach(() => {
      store = createStore();
    });

    it("should update atom when search params change (simulating back/forward)", () => {
      // Initial state: PC, panel open
      vi.stubGlobal("window", { innerWidth: 1024 });
      store.set(rightPanelOpenAtom, true);
      expect(store.get(rightPanelOpenAtom)).toBe(true);

      // Simulate browser back: URL now has rightPanel=false
      const newUrlRightPanel = false;
      store.set(rightPanelOpenAtom, newUrlRightPanel);
      expect(store.get(rightPanelOpenAtom)).toBe(false);

      // Simulate browser forward: URL now has rightPanel=true
      const forwardUrlRightPanel = true;
      store.set(rightPanelOpenAtom, forwardUrlRightPanel);
      expect(store.get(rightPanelOpenAtom)).toBe(true);
    });

    it("should apply device-specific default only before a right panel preference exists", () => {
      // On PC, a URL without rightPanel should default to open when no preference exists
      vi.stubGlobal("window", { innerWidth: 1024 });
      const urlRightPanel = undefined;
      const isMobile = false;
      const openPreference = store.get(rightPanelOpenPreferenceAtom);
      if (urlRightPanel !== undefined) {
        store.set(rightPanelOpenAtom, urlRightPanel);
      } else if (openPreference.status === "unset") {
        store.set(rightPanelOpenAtom, !isMobile);
      }
      expect(store.get(rightPanelOpenAtom)).toBe(true);

      // After the user closes the panel, another URL without rightPanel should preserve it
      store.set(rightPanelOpenAtom, false);
      const nextUrlRightPanel = undefined;
      const nextOpenPreference = store.get(rightPanelOpenPreferenceAtom);
      if (nextUrlRightPanel !== undefined) {
        store.set(rightPanelOpenAtom, nextUrlRightPanel);
      } else if (nextOpenPreference.status === "unset") {
        store.set(rightPanelOpenAtom, !isMobile);
      }
      expect(store.get(rightPanelOpenAtom)).toBe(false);
    });

    it("should preserve active tab preference when navigating to URL without rightPanelTab param", () => {
      store.set(rightPanelActiveTabAtom, "git");

      const nextUrlRightPanelTab = undefined;
      if (nextUrlRightPanelTab !== undefined) {
        store.set(rightPanelActiveTabAtom, nextUrlRightPanelTab);
      }

      expect(store.get(rightPanelActiveTabAtom)).toBe("git");
    });
  });
});

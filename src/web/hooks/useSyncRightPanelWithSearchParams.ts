import { useStore } from "jotai";
import { useEffect, useRef } from "react";
import {
  rightPanelActiveTabAtom,
  rightPanelOpenAtom,
  rightPanelOpenPreferenceAtom,
} from "@/lib/atoms/rightPanel";
import { Route } from "@/web/routes/projects/$projectId/session";
import { getIsMobileSync } from "./getIsMobileSync";
import { resolveRightPanelOpen } from "./resolveRightPanelOpen";
import { useIsMobile } from "./useIsMobile";

/**
 * Bidirectionally syncs jotai right panel atoms with TanStack Router search params.
 *
 * - On mount: URL search params override stored preferences when explicitly present
 * - On atom change: updates URL (replace, no navigation)
 * - On search param change (e.g. browser back/forward): updates atoms only for explicit params
 *
 * When URL `rightPanel` is undefined and no stored preference exists, a device-specific default is used:
 * - PC (width > 767px): default open (true)
 * - Mobile (width <= 767px): default closed (false)
 */
export const useSyncRightPanelWithSearchParams = () => {
  const store = useStore();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const isSyncingFromUrl = useRef(false);
  const isSyncingFromAtom = useRef(false);

  // Use synchronous initial value to avoid flicker, then reactively update
  const isMobile = useIsMobile();
  // Track if initial sync has been done to avoid applying defaults after explicit user action
  const hasInitializedRef = useRef(false);

  // On mount: initialize atoms from explicit URL params, falling back to stored preferences.
  useEffect(() => {
    isSyncingFromUrl.current = true;

    // For initial mount, use sync check to avoid flicker
    // For subsequent updates (e.g., browser back/forward), use current isMobile value
    const effectiveIsMobile = hasInitializedRef.current ? isMobile : getIsMobileSync();

    if (search.rightPanel !== undefined) {
      store.set(rightPanelOpenAtom, search.rightPanel);
    } else if (store.get(rightPanelOpenPreferenceAtom).status === "unset") {
      store.set(rightPanelOpenAtom, resolveRightPanelOpen(undefined, effectiveIsMobile));
    }

    if (search.rightPanelTab !== undefined) {
      store.set(rightPanelActiveTabAtom, search.rightPanelTab);
    }

    hasInitializedRef.current = true;
    isSyncingFromUrl.current = false;
  }, [search.rightPanel, search.rightPanelTab, store, isMobile]);

  // Subscribe to atom changes → update URL
  useEffect(() => {
    const unsubOpen = store.sub(rightPanelOpenAtom, () => {
      if (isSyncingFromUrl.current) return;
      isSyncingFromAtom.current = true;
      const isOpen = store.get(rightPanelOpenAtom);
      void navigate({
        search: (prev) => ({ ...prev, rightPanel: isOpen }),
        replace: true,
      });
      // Reset flag after microtask to avoid feedback loop
      queueMicrotask(() => {
        isSyncingFromAtom.current = false;
      });
    });

    const unsubTab = store.sub(rightPanelActiveTabAtom, () => {
      if (isSyncingFromUrl.current) return;
      isSyncingFromAtom.current = true;
      const tab = store.get(rightPanelActiveTabAtom);
      void navigate({
        search: (prev) => ({ ...prev, rightPanelTab: tab }),
        replace: true,
      });
      queueMicrotask(() => {
        isSyncingFromAtom.current = false;
      });
    });

    return () => {
      unsubOpen();
      unsubTab();
    };
  }, [store, navigate]);
};

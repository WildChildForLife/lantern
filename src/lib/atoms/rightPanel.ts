import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { RefObject } from "react";
import type { RightPanelTab } from "../types/rightPanel.ts";

type RightPanelOpenPreference =
  | { readonly status: "unset" }
  | { readonly status: "set"; readonly value: boolean };

export const rightPanelResizingAtom = atom(false);
export const rightPanelOpenPreferenceAtom = atomWithStorage<RightPanelOpenPreference>(
  "rightPanelOpen",
  { status: "unset" },
);
export const rightPanelOpenAtom = atom(
  (get) => {
    const preference = get(rightPanelOpenPreferenceAtom);
    if (preference.status === "set") {
      return preference.value;
    }
    return false;
  },
  (_get, set, value: boolean) => {
    set(rightPanelOpenPreferenceAtom, { status: "set", value });
  },
);
export const rightPanelActiveTabAtom = atomWithStorage<RightPanelTab>(
  "rightPanelActiveTab",
  "explorer",
);
export const rightPanelWidthAtom = atom(28);
export const rightPanelTodoOpenAtom = atom(true);

export const rightPanelBrowserUrlAtom = atom<string | null>(null);
export const rightPanelCurrentUrlAtom = atom<string | null>(null);
export const rightPanelInputUrlAtom = atom("");

export const rightPanelIframeRefAtom = atom<RefObject<HTMLIFrameElement | null>>({
  current: null,
});

import type { RightPanelTab } from "@/lib/types/rightPanel";
import { resolveRightPanelOpen } from "./resolveRightPanelOpen.ts";

/**
 * What a URL visit should do to a stored right panel value.
 * `keep` leaves the stored preference untouched.
 */
export type RightPanelSync<T> =
  | { readonly action: "set"; readonly value: T }
  | { readonly action: "keep" };

/**
 * Decides how a URL visit should affect the right panel open state.
 * - An explicit `rightPanel` search param always wins.
 * - Without it, the device-specific default applies only while no preference is
 *   stored, so a panel the user closed stays closed on later navigations.
 */
export const resolveRightPanelOpenSync = (
  urlValue: boolean | undefined,
  hasStoredPreference: boolean,
  isMobile: boolean,
): RightPanelSync<boolean> => {
  if (urlValue !== undefined) {
    return { action: "set", value: urlValue };
  }
  if (!hasStoredPreference) {
    return { action: "set", value: resolveRightPanelOpen(undefined, isMobile) };
  }
  return { action: "keep" };
};

/**
 * Decides how a URL visit should affect the active right panel tab. An explicit
 * `rightPanelTab` search param wins; without it the stored tab is preserved.
 */
export const resolveRightPanelTabSync = (
  urlValue: RightPanelTab | undefined,
): RightPanelSync<RightPanelTab> =>
  urlValue === undefined ? { action: "keep" } : { action: "set", value: urlValue };

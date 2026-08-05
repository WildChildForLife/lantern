const PREFIX = "lantern-";
const LEGACY_PREFIX = "claude-code-viewer-";

/**
 * Copies preferences written by a pre-rename build onto the new key names, so a
 * rename does not silently reset everyone's view mode, drafts and done list.
 *
 * Runs when this module is first evaluated, which is before any atom that calls
 * {@link storageKey} can read from storage. The legacy entries are left in place
 * — reverting to an older build should still find its own data.
 */
const migrateLegacyKeys = (): void => {
  if (typeof window === "undefined") return;

  const storage = window.localStorage;
  const pending: Array<readonly [string, string]> = [];

  for (let index = 0; index < storage.length; index += 1) {
    const legacyKey = storage.key(index);
    if (legacyKey === null || !legacyKey.startsWith(LEGACY_PREFIX)) continue;

    const key = `${PREFIX}${legacyKey.slice(LEGACY_PREFIX.length)}`;
    if (storage.getItem(key) !== null) continue;

    const value = storage.getItem(legacyKey);
    if (value !== null) pending.push([key, value]);
  }

  for (const [key, value] of pending) {
    try {
      storage.setItem(key, value);
    } catch {
      // A full or blocked storage is not worth breaking the app over.
    }
  }
};

try {
  migrateLegacyKeys();
} catch {
  // Private-mode browsers throw on localStorage access.
}

/** Namespaced localStorage key, e.g. `storageKey("view-mode")`. */
export const storageKey = (name: string): string => `${PREFIX}${name}`;

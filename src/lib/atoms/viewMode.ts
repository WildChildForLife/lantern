import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { z } from "zod";

export const viewModeSchema = z.enum(["grid", "list", "table"]);

export type ViewMode = z.infer<typeof viewModeSchema>;

/**
 * How card collections (projects, conversations) are laid out. Persisted so the
 * choice survives reloads, and shared by every listing so the app feels
 * consistent.
 */
const viewModeAtom = atomWithStorage<ViewMode>("claude-code-viewer-view-mode", "list");

export const useViewMode = () => {
  const [storedViewMode, setViewMode] = useAtom(viewModeAtom);

  // A mode written by an older version (or by hand) must not break the layout.
  const parsed = viewModeSchema.safeParse(storedViewMode);

  return { viewMode: parsed.success ? parsed.data : "list", setViewMode } as const;
};

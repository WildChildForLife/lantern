import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { z } from "zod";
import { storageKey } from "./storageKey";

export const viewModeSchema = z.enum(["grid", "list", "table", "projects"]);

export type ViewMode = z.infer<typeof viewModeSchema>;

/**
 * How the overview lays out its cards: conversations grouped by topic as rows,
 * cards or one column per topic, or grouped by the project they belong to.
 * Persisted so the choice survives reloads, and shared by every listing so the
 * app feels consistent.
 */
const viewModeAtom = atomWithStorage<ViewMode>(storageKey("view-mode"), "list");

export const useViewMode = () => {
  const [storedViewMode, setViewMode] = useAtom(viewModeAtom);

  // A mode written by an older version (or by hand) must not break the layout.
  const parsed = viewModeSchema.safeParse(storedViewMode);

  return { viewMode: parsed.success ? parsed.data : "list", setViewMode } as const;
};

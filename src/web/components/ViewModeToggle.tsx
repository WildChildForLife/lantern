import { useNavigate } from "@tanstack/react-router";
import { Columns3Icon, FolderIcon, LayoutGridIcon, ListIcon } from "lucide-react";
import type { FC } from "react";
import { useViewMode, type ViewMode } from "@/lib/atoms/viewMode";
import { cn } from "@/web/utils";

const options: { mode: ViewMode; label: string; Icon: typeof ListIcon }[] = [
  { mode: "list", label: "List view", Icon: ListIcon },
  { mode: "grid", label: "Grid view", Icon: LayoutGridIcon },
  { mode: "table", label: "Table view, one column per topic", Icon: Columns3Icon },
  { mode: "projects", label: "Project view, grouped by project", Icon: FolderIcon },
];

/** The overview owns every mode, so picking one it alone renders goes there. */
const OVERVIEW_ROUTE = "/topics";

type Props = {
  /** Modes this page renders itself. The rest stay visible and navigate instead. */
  modes?: readonly ViewMode[];
};

export const ViewModeToggle: FC<Props> = ({ modes = ["list", "grid"] }) => {
  const { viewMode, setViewMode } = useViewMode();
  const navigate = useNavigate();

  // Every mode is always shown. A control whose buttons come and go between
  // pages is harder to read than one that always offers the same four choices.
  const activeMode = modes.includes(viewMode) ? viewMode : "list";

  const select = (mode: ViewMode) => {
    setViewMode(mode);

    if (!modes.includes(mode)) {
      void navigate({ to: OVERVIEW_ROUTE });
    }
  };

  return (
    <div className="inline-flex items-center rounded-md border border-border p-0.5">
      {options.map(({ mode, label, Icon }) => {
        const supported = modes.includes(mode);
        const description = supported ? label : `${label} (opens the overview)`;

        return (
          <button
            key={mode}
            type="button"
            aria-label={description}
            title={description}
            aria-pressed={activeMode === mode}
            onClick={() => select(mode)}
            className={cn(
              "flex h-7 w-8 items-center justify-center rounded transition-colors text-muted-foreground hover:text-foreground",
              activeMode === mode && "bg-muted text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
};

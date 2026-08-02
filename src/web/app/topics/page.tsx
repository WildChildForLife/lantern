import { Link } from "@tanstack/react-router";
import { CheckCheckIcon, FolderIcon, MessagesSquareIcon } from "lucide-react";
import { type FC, useState } from "react";
import { useDoneConversations } from "@/lib/atoms/doneConversations";
import { useViewMode } from "@/lib/atoms/viewMode";
import { NotificationBell } from "@/web/app/components/NotificationBell";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { ViewModeToggle } from "@/web/components/ViewModeToggle";
import { cn } from "@/web/utils";
import { ClassifyTopicsButton } from "./components/ClassifyTopicsButton";
import { TopicList } from "./components/TopicList";
import { TopicTable } from "./components/TopicTable";

export const TopicsPage: FC = () => {
  const [query, setQuery] = useState("");
  const [hideDone, setHideDone] = useState(false);
  const { viewMode } = useViewMode();
  const { doneCount, clearDone } = useDoneConversations();

  // The table puts every topic side by side, so it wants the whole window.
  const isTable = viewMode === "table";

  return (
    <div className="flex flex-col h-screen max-h-screen overflow-hidden">
      <header className="h-(--spacing-header-height) flex items-center justify-between px-3 bg-muted/30 border-b border-border/40 text-xs flex-shrink-0 select-none">
        <span className="text-sm font-semibold text-foreground">Lantern</span>
        <div className="flex items-center gap-1">
          <Link
            to="/conversations"
            className="flex items-center gap-1.5 h-7 px-2 rounded transition-colors hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <MessagesSquareIcon className="w-3.5 h-3.5" />
            <span>All conversations</span>
          </Link>
          <Link
            to="/projects"
            className="flex items-center gap-1.5 h-7 px-2 rounded transition-colors hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <FolderIcon className="w-3.5 h-3.5" />
            <span>Projects</span>
          </Link>
          <ClassifyTopicsButton />
          <NotificationBell />
        </div>
      </header>

      <div className={cn("flex-1 min-h-0", isTable ? "flex flex-col" : "overflow-auto")}>
        <div
          className={cn(
            "flex flex-col min-h-0",
            isTable ? "flex-1 w-full px-4 py-6" : "container mx-auto px-4 py-8",
          )}
        >
          <header className="mb-6">
            <h1 className="text-xl font-semibold">Topics</h1>
            <p className="text-muted-foreground text-sm">
              Conversations grouped by what they are about, not by the folder they were started in.
            </p>
          </header>

          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter topics..."
              className="max-w-md"
            />
            <Button
              variant={hideDone ? "default" : "outline"}
              size="sm"
              onClick={() => setHideDone((current) => !current)}
            >
              <CheckCheckIcon className="w-4 h-4" />
              {hideDone ? "Showing open only" : `Hide done (${doneCount})`}
            </Button>
            {doneCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearDone}>
                Clear done
              </Button>
            )}
            <ViewModeToggle modes={["list", "grid", "table"]} />
          </div>

          {isTable ? <TopicTable query={query} hideDone={hideDone} /> : <TopicList query={query} />}
        </div>
      </div>
    </div>
  );
};

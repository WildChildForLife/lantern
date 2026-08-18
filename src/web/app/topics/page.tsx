import { Trans, useLingui } from "@lingui/react";
import { Link } from "@tanstack/react-router";
import { CheckCheckIcon, InfoIcon, MessagesSquareIcon, SearchIcon } from "lucide-react";
import { type FC, Suspense, useState } from "react";
import { useDoneConversations } from "@/lib/atoms/doneConversations";
import { useViewMode } from "@/lib/atoms/viewMode";
import { NotificationBell } from "@/web/app/components/NotificationBell";
import { ProjectList } from "@/web/app/projects/components/ProjectList";
import { SetupProjectDialog } from "@/web/app/projects/components/SetupProjectDialog";
import { useSearch } from "@/web/components/SearchProvider";
import { SettingsButton } from "@/web/components/SettingsButton";
import { SystemInfoCard } from "@/web/components/SystemInfoCard";
import { RedoAllTopicsButton } from "@/web/components/topics/RedoAllTopicsButton";
import { SortUnsortedTopicsButton } from "@/web/components/topics/SortUnsortedTopicsButton";
import { Button } from "@/web/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/web/components/ui/dialog";
import { Input } from "@/web/components/ui/input";
import { ViewModeToggle } from "@/web/components/ViewModeToggle";
import { cn } from "@/web/utils";
import { TopicList } from "./components/TopicList";
import { TopicTable } from "./components/TopicTable";

/**
 * The overview. Topics and projects are two ways of grouping the same
 * conversations, so they share one page and one view mode control instead of
 * two pages with two overlapping toggles.
 */
export const TopicsPage: FC = () => {
  const { i18n } = useLingui();
  const [query, setQuery] = useState("");
  const [hideDone, setHideDone] = useState(false);
  const [isSystemInfoOpen, setIsSystemInfoOpen] = useState(false);
  const { viewMode } = useViewMode();
  const { openSearch } = useSearch();
  const { doneCount, clearDone } = useDoneConversations();

  // The table puts every topic side by side, so it wants the whole window.
  const isTable = viewMode === "table";
  const isProjects = viewMode === "projects";

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
            <span>
              <Trans id="nav.all_conversations" message="All conversations" />
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setIsSystemInfoOpen(true)}
            className="w-11 h-11 md:w-7 md:h-7 flex items-center justify-center rounded transition-colors hover:bg-muted text-muted-foreground hover:text-foreground"
            aria-label="System Info"
          >
            <InfoIcon className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={openSearch}
            className="w-11 h-11 md:w-7 md:h-7 flex items-center justify-center rounded transition-colors hover:bg-muted text-muted-foreground hover:text-foreground"
            aria-label="Search"
          >
            <SearchIcon className="w-3.5 h-3.5" />
          </button>
          <SortUnsortedTopicsButton />
          <RedoAllTopicsButton />
          <SettingsButton />
          <NotificationBell />
        </div>
      </header>

      <Dialog open={isSystemInfoOpen} onOpenChange={setIsSystemInfoOpen}>
        <DialogContent className="max-w-md h-[70vh] overflow-hidden p-0">
          <DialogTitle className="sr-only">System Info</DialogTitle>
          <Suspense
            fallback={<div className="p-8 text-center text-muted-foreground">Loading...</div>}
          >
            <SystemInfoCard />
          </Suspense>
        </DialogContent>
      </Dialog>

      <div className={cn("flex-1 min-h-0", isTable ? "flex flex-col" : "overflow-auto")}>
        <div
          className={cn(
            "flex flex-col min-h-0",
            isTable ? "flex-1 w-full px-4 py-6" : "container mx-auto px-4 py-8",
          )}
        >
          <header className="mb-6">
            <h1 className="text-xl font-semibold">
              {isProjects ? (
                <Trans id="projects.page.title" />
              ) : (
                <Trans id="topics.title" message="Topics" />
              )}
            </h1>
            <p className="text-muted-foreground text-sm">
              {isProjects ? (
                <Trans id="projects.page.description" />
              ) : (
                <Trans
                  id="topics.subtitle"
                  message="Conversations grouped by what they are about, not by the folder they were started in."
                />
              )}
            </p>
          </header>

          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                isProjects
                  ? i18n._({ id: "projects.filter.placeholder", message: "Filter projects..." })
                  : i18n._({ id: "topics.filter.placeholder", message: "Filter topics..." })
              }
              className="max-w-md"
            />
            {!isProjects && (
              <>
                <Button
                  variant={hideDone ? "default" : "outline"}
                  size="sm"
                  onClick={() => setHideDone((current) => !current)}
                >
                  <CheckCheckIcon className="w-4 h-4" />
                  {hideDone ? (
                    <Trans id="list.showing_open_only" message="Showing open only" />
                  ) : (
                    <Trans
                      id="list.hide_done"
                      message="Hide done ({doneCount})"
                      values={{ doneCount }}
                    />
                  )}
                </Button>
                {doneCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearDone}>
                    <Trans id="list.clear_done" message="Clear done" />
                  </Button>
                )}
              </>
            )}
            <ViewModeToggle modes={["list", "grid", "table", "projects"]} />
            {isProjects && <SetupProjectDialog />}
          </div>

          {isProjects ? (
            <Suspense
              fallback={
                <div className="flex items-center justify-center py-12">
                  <div className="text-muted-foreground">
                    <Trans id="projects.page.loading" />
                  </div>
                </div>
              }
            >
              <ProjectList query={query} />
            </Suspense>
          ) : isTable ? (
            <TopicTable query={query} hideDone={hideDone} />
          ) : (
            <TopicList query={query} />
          )}
        </div>
      </div>
    </div>
  );
};

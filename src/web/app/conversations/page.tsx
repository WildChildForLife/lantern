import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCheckIcon, FolderIcon, LayoutGridIcon, XIcon } from "lucide-react";
import { type FC, useState } from "react";
import { useDoneConversations } from "@/lib/atoms/doneConversations";
import { NotificationBell } from "@/web/app/components/NotificationBell";
import { TopicIcon } from "@/web/components/TopicIcon";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { ViewModeToggle } from "@/web/components/ViewModeToggle";
import { conversationTopicsQuery } from "@/web/lib/api/queries";
import { topicColorClass } from "@/web/lib/topicColor";
import { cn } from "@/web/utils";
import { ConversationList } from "./components/ConversationList";

const PAGE_SIZE = 50;

type Props = {
  topic?: string | undefined;
};

export const ConversationsPage: FC<Props> = ({ topic }) => {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hideDone, setHideDone] = useState(false);
  const { doneCount, clearDone } = useDoneConversations();
  const { data: topicsData } = useQuery(conversationTopicsQuery);
  const activeTopic = topicsData?.topics.find((candidate) => candidate.id === topic);

  return (
    <div className="flex flex-col h-screen max-h-screen overflow-hidden">
      <header className="h-(--spacing-header-height) flex items-center justify-between px-3 bg-muted/30 border-b border-border/40 text-xs flex-shrink-0 select-none">
        <span className="text-sm font-semibold text-foreground">Lantern</span>
        <div className="flex items-center gap-1">
          <Link
            to="/topics"
            className="flex items-center gap-1.5 h-7 px-2 rounded transition-colors hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <LayoutGridIcon className="w-3.5 h-3.5" />
            <span>Topics</span>
          </Link>
          <Link
            to="/projects"
            className="flex items-center gap-1.5 h-7 px-2 rounded transition-colors hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <FolderIcon className="w-3.5 h-3.5" />
            <span>Projects</span>
          </Link>
          <NotificationBell />
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="container mx-auto px-4 py-8">
          <header className="mb-6">
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              {activeTopic !== undefined && (
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-md",
                    topicColorClass(activeTopic.id),
                  )}
                >
                  <TopicIcon name={activeTopic.icon} className="h-4 w-4" />
                </span>
              )}
              {activeTopic?.label ?? "All conversations"}
            </h1>
            <p className="text-muted-foreground text-sm">
              {topic === undefined
                ? "Every Claude Code session across every project, newest first."
                : "Conversations in this topic, newest first."}
            </p>
            {topic !== undefined && (
              <Button asChild variant="ghost" size="sm" className="mt-2 -ml-2">
                <Link to="/conversations" search={{}}>
                  <XIcon className="w-4 h-4" />
                  Clear topic
                </Link>
              </Button>
            )}
          </header>

          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(PAGE_SIZE);
              }}
              placeholder="Filter by title, first message or project..."
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
            <ViewModeToggle />
          </div>

          <ConversationList
            query={query}
            topic={topic}
            limit={limit}
            hideDone={hideDone}
            onLoadMore={() => setLimit((current) => current + PAGE_SIZE)}
          />
        </div>
      </div>
    </div>
  );
};

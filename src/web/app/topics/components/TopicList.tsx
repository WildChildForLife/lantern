import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { FC } from "react";
import { useViewMode } from "@/lib/atoms/viewMode";
import { TopicIcon } from "@/web/components/TopicIcon";
import { Card, CardContent } from "@/web/components/ui/card";
import { conversationTopicsQuery } from "@/web/lib/api/queries";
import { topicColorClass } from "@/web/lib/topicColor";
import { cn } from "@/web/utils";

type Props = {
  query: string;
};

export const TopicList: FC<Props> = ({ query }) => {
  const { viewMode } = useViewMode();
  const { data, isPending, isError } = useQuery(conversationTopicsQuery);

  if (isError) {
    return <p className="text-sm text-destructive">Failed to load topics.</p>;
  }

  if (isPending) {
    return <p className="text-sm text-muted-foreground">Loading topics...</p>;
  }

  const normalized = query.trim().toLowerCase();
  const topics = data.topics.filter(
    (topic) => normalized === "" || topic.label.toLowerCase().includes(normalized),
  );

  if (topics.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No topics to show{query === "" ? "" : ` for "${query}"`}.
      </p>
    );
  }

  return (
    <div
      className={cn(
        viewMode === "grid"
          ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          : "flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden",
      )}
    >
      {topics.map((topic) =>
        viewMode === "grid" ? (
          <Link key={topic.id} to="/conversations" search={{ topic: topic.id }}>
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardContent className="flex items-center gap-3 py-5">
                <span
                  className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg",
                    topicColorClass(topic.id),
                  )}
                >
                  <TopicIcon name={topic.icon} className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{topic.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {topic.count} conversation{topic.count === 1 ? "" : "s"}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ) : (
          <Link
            key={topic.id}
            to="/conversations"
            search={{ topic: topic.id }}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
          >
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                topicColorClass(topic.id),
              )}
            >
              <TopicIcon name={topic.icon} className="h-4 w-4" />
            </span>
            <p className="min-w-0 flex-1 truncate text-sm font-medium">{topic.label}</p>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {topic.count}
            </span>
          </Link>
        ),
      )}
    </div>
  );
};

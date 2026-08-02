import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { MessageSquareIcon } from "lucide-react";
import type { FC } from "react";
import { useDoneConversations } from "@/lib/atoms/doneConversations";
import { useViewMode } from "@/lib/atoms/viewMode";
import { formatLocaleDate } from "@/lib/date/formatLocaleDate";
import { CopySessionIdButton } from "@/web/components/CopySessionIdButton";
import { TopicIcon } from "@/web/components/TopicIcon";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent } from "@/web/components/ui/card";
import { Checkbox } from "@/web/components/ui/checkbox";
import { conversationListQuery } from "@/web/lib/api/queries";
import { topicTextColorClass } from "@/web/lib/topicColor";
import { cn } from "@/web/utils";
import { useConfig } from "../../hooks/useConfig";
import {
  resolveSessionTitle,
  toConciseTitle,
} from "../../projects/[projectId]/services/firstCommandToTitle";

type Props = {
  query: string;
  topic?: string | undefined;
  limit: number;
  hideDone: boolean;
  onLoadMore: () => void;
};

export const ConversationList: FC<Props> = ({ query, topic, limit, hideDone, onLoadMore }) => {
  const { viewMode } = useViewMode();
  const { config } = useConfig();
  const { isDone, setDone } = useDoneConversations();

  const { data, isPending, isError } = useQuery({
    ...conversationListQuery({ query, limit, topic }),
    placeholderData: (previous) => previous,
  });

  if (isError) {
    return <p className="text-sm text-destructive">Failed to load conversations.</p>;
  }

  if (isPending) {
    return <p className="text-sm text-muted-foreground">Loading conversations...</p>;
  }

  const { conversations, total } = data;

  const rows = conversations
    .map((conversation) => ({
      ...conversation,
      done: isDone(conversation.sessionId),
      title: toConciseTitle(
        resolveSessionTitle(
          conversation.title,
          conversation.firstUserMessage,
          conversation.sessionId,
        ),
      ),
      projectLabel: conversation.projectName ?? conversation.projectPath ?? conversation.projectId,
      modifiedLabel: formatLocaleDate(conversation.lastModifiedAt, {
        locale: config.locale,
        target: "time",
      }),
    }))
    .filter((row) => !hideDone || !row.done);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No conversations to show{query === "" ? "" : ` for "${query}"`}.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {rows.length} of {total} conversations
      </p>

      <div
        className={cn(
          viewMode === "grid"
            ? "grid gap-4 md:grid-cols-2 lg:grid-cols-3"
            : "flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden",
        )}
      >
        {rows.map((row) => {
          const doneCheckbox = (
            <Checkbox
              checked={row.done}
              onCheckedChange={(checked) => setDone(row.sessionId, checked === true)}
              aria-label={row.done ? "Mark as not done" : "Mark as done"}
              title={row.done ? "Mark as not done" : "Mark as done"}
              className="shrink-0"
            />
          );

          if (viewMode === "grid") {
            return (
              <Card
                key={row.sessionId}
                className={cn("h-full transition-shadow hover:shadow-md", row.done && "opacity-50")}
              >
                <CardContent className="flex h-full flex-col gap-2 py-4">
                  <div className="flex items-start gap-2">
                    {doneCheckbox}
                    <Link
                      to="/projects/$projectId/session"
                      params={{ projectId: row.projectId }}
                      search={{ tab: "sessions", sessionId: row.sessionId }}
                      className="min-w-0 flex-1"
                    >
                      <p
                        className={cn(
                          "text-sm font-medium leading-snug line-clamp-3",
                          row.done && "line-through",
                        )}
                      >
                        {row.title}
                      </p>
                    </Link>
                    <CopySessionIdButton sessionId={row.sessionId} />
                  </div>
                  <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    <TopicIcon
                      name={row.topic.icon}
                      className={cn("h-3 w-3 shrink-0", topicTextColorClass(row.topic.id))}
                    />
                    <span className="truncate">{row.topic.label}</span>
                    <span className="truncate text-muted-foreground/70">· {row.projectLabel}</span>
                  </p>
                  <div className="mt-auto flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <MessageSquareIcon className="h-3 w-3" />
                      {row.messageCount}
                    </span>
                    <span>{row.modifiedLabel}</span>
                  </div>
                  <p className="truncate font-mono text-[10px] text-muted-foreground/70">
                    {row.sessionId}
                  </p>
                </CardContent>
              </Card>
            );
          }

          return (
            <div
              key={row.sessionId}
              className={cn(
                "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60",
                row.done && "opacity-50",
              )}
            >
              {doneCheckbox}
              <Link
                to="/projects/$projectId/session"
                params={{ projectId: row.projectId }}
                search={{ tab: "sessions", sessionId: row.sessionId }}
                className="min-w-0 flex-1"
              >
                <p className={cn("truncate text-sm font-medium", row.done && "line-through")}>
                  {row.title}
                </p>
                <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                  <TopicIcon
                    name={row.topic.icon}
                    className={cn("h-3 w-3 shrink-0", topicTextColorClass(row.topic.id))}
                  />
                  <span className="truncate">{row.topic.label}</span>
                  <span className="truncate text-muted-foreground/70">· {row.projectLabel}</span>
                  <span className="ml-2 font-mono text-[10px] text-muted-foreground/70">
                    {row.sessionId}
                  </span>
                </p>
              </Link>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums">
                <MessageSquareIcon className="h-3 w-3" />
                {row.messageCount}
              </span>
              <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline">
                {row.modifiedLabel}
              </span>
              <CopySessionIdButton sessionId={row.sessionId} />
            </div>
          );
        })}
      </div>

      {conversations.length < total && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={onLoadMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
};

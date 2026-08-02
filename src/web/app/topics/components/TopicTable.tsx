import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { MessageSquareIcon } from "lucide-react";
import type { FC } from "react";
import { useDoneConversations } from "@/lib/atoms/doneConversations";
import { formatLocaleDate } from "@/lib/date/formatLocaleDate";
import { CopySessionIdButton } from "@/web/components/CopySessionIdButton";
import { TopicIcon } from "@/web/components/TopicIcon";
import { Checkbox } from "@/web/components/ui/checkbox";
import { conversationListQuery, conversationTopicsQuery } from "@/web/lib/api/queries";
import { topicColorClass } from "@/web/lib/topicColor";
import { cn } from "@/web/utils";
import { useConfig } from "../../hooks/useConfig";
import {
  resolveSessionTitle,
  toConciseTitle,
} from "../../projects/[projectId]/services/firstCommandToTitle";

/** The list endpoint caps a page at 200 rows. */
const MAX_ROWS = 200;

type Props = {
  query: string;
  hideDone: boolean;
};

/**
 * Every topic side by side, one column each, so the whole dashboard is visible
 * without opening a category first.
 */
export const TopicTable: FC<Props> = ({ query, hideDone }) => {
  const { isDone, setDone } = useDoneConversations();
  const { config } = useConfig();
  const topicsResult = useQuery(conversationTopicsQuery);
  const conversationsResult = useQuery(conversationListQuery({ query: "", limit: MAX_ROWS }));

  if (topicsResult.isError || conversationsResult.isError) {
    return <p className="text-sm text-destructive">Failed to load topics.</p>;
  }

  if (topicsResult.isPending || conversationsResult.isPending) {
    return <p className="text-sm text-muted-foreground">Loading topics...</p>;
  }

  const { conversations, total } = conversationsResult.data;

  // Most recent conversation per topic, taken before the "hide done" filter so
  // the column order does not jump around while ticking conversations off.
  const lastActivityByTopic = new Map<string, number>();
  for (const conversation of conversations) {
    const at = new Date(conversation.lastModifiedAt).getTime();
    const current = lastActivityByTopic.get(conversation.topic.id);
    if (current === undefined || at > current) {
      lastActivityByTopic.set(conversation.topic.id, at);
    }
  }

  const normalized = query.trim().toLowerCase();
  const columns = topicsResult.data.topics
    .filter((topic) => normalized === "" || topic.label.toLowerCase().includes(normalized))
    // Freshest topic first: the thing worked on last is the thing being looked for.
    .sort(
      (left, right) =>
        (lastActivityByTopic.get(right.id) ?? 0) - (lastActivityByTopic.get(left.id) ?? 0),
    )
    .map((topic) => ({
      topic,
      rows: conversations
        .filter((conversation) => conversation.topic.id === topic.id)
        .map((conversation) => ({
          ...conversation,
          done: isDone(conversation.sessionId),
          title: toConciseTitle(
            resolveSessionTitle(
              conversation.title,
              conversation.firstUserMessage,
              conversation.sessionId,
            ),
            80,
          ),
          modifiedLabel: formatLocaleDate(conversation.lastModifiedAt, {
            locale: config.locale,
            target: "time",
          }),
        }))
        .filter((row) => !hideDone || !row.done),
    }));

  if (columns.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No topics to show{query === "" ? "" : ` for "${query}"`}.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {total > conversations.length && (
        <p className="text-xs text-muted-foreground">
          Showing the {conversations.length} most recent conversations of {total}.
        </p>
      )}

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
        {columns.map(({ topic, rows }) => (
          <section
            key={topic.id}
            className="flex min-h-0 w-72 shrink-0 flex-col rounded-lg border border-border"
          >
            <header className="flex items-center gap-2 border-b border-border px-3 py-2">
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                  topicColorClass(topic.id),
                )}
              >
                <TopicIcon name={topic.icon} className="h-4 w-4" />
              </span>
              <Link
                to="/conversations"
                search={{ topic: topic.id }}
                className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
              >
                {topic.label}
              </Link>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {topic.count}
              </span>
            </header>

            <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
              {rows.length === 0 ? (
                <p className="px-3 py-3 text-xs text-muted-foreground">Nothing to show.</p>
              ) : (
                rows.map((row) => (
                  <div
                    key={row.sessionId}
                    className={cn(
                      "flex items-start gap-2 px-3 py-2 transition-colors hover:bg-muted/60",
                      row.done && "opacity-50",
                    )}
                  >
                    <Checkbox
                      checked={row.done}
                      onCheckedChange={(checked) => setDone(row.sessionId, checked === true)}
                      aria-label={row.done ? "Mark as not done" : "Mark as done"}
                      title={row.done ? "Mark as not done" : "Mark as done"}
                      className="mt-0.5 shrink-0"
                    />
                    <Link
                      to="/projects/$projectId/session"
                      params={{ projectId: row.projectId }}
                      search={{ tab: "sessions", sessionId: row.sessionId }}
                      className="min-w-0 flex-1"
                    >
                      <p
                        className={cn(
                          "text-xs leading-snug line-clamp-3",
                          row.done && "line-through",
                        )}
                      >
                        {row.title}
                      </p>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1 tabular-nums">
                          <MessageSquareIcon className="h-3 w-3" />
                          {row.messageCount}
                        </span>
                        <span className="truncate tabular-nums">{row.modifiedLabel}</span>
                      </span>
                    </Link>
                    <CopySessionIdButton sessionId={row.sessionId} className="h-6 w-6" />
                  </div>
                ))
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};

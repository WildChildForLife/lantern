import { useLingui } from "@lingui/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCheckIcon, MessageSquareIcon } from "lucide-react";
import { type FC, useEffect, useRef } from "react";
import { useConversationSelection } from "@/lib/atoms/conversationSelection";
import { useDoneConversations } from "@/lib/atoms/doneConversations";
import { formatLocaleDate } from "@/lib/date/formatLocaleDate";
import { MAX_CLASSIFY_PER_PASS } from "@/lib/topics/classifyLimits";
import { ConversationSelectionBar } from "@/web/components/conversations/ConversationSelectionBar";
import { CopySessionIdButton } from "@/web/components/CopySessionIdButton";
import { TopicIcon } from "@/web/components/TopicIcon";
import { Button } from "@/web/components/ui/button";
import { Checkbox } from "@/web/components/ui/checkbox";
import { conversationListQuery, conversationTopicsQuery } from "@/web/lib/api/queries";
import { useClassifyTopics } from "@/web/lib/api/useClassifyTopics";
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
  const { isDone, setDone, setManyDone } = useDoneConversations();
  const { config } = useConfig();
  const { i18n } = useLingui();
  const {
    isSelected,
    setSelected,
    selectRange,
    selectAll,
    clearSelection,
    selectedInOrder,
    selectedCount,
  } = useConversationSelection();
  const { classify, isClassifying } = useClassifyTopics();

  /** See ConversationList: Radix reports the new state, not the event. */
  const rangeIntent = useRef(false);

  useEffect(() => clearSelection, [clearSelection]);

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
          selected: isSelected(conversation.sessionId),
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

  // Select-all spans every column, but a shift-range is measured inside the
  // column it was started in: a range across columns means nothing here.
  const orderedIds = columns.flatMap(({ rows }) => rows.map((row) => row.sessionId));
  const selectedIds = selectedInOrder(orderedIds);

  /** What the buttons would act on — see ConversationList for why this differs. */
  const actionableCount = selectedIds.length;
  const sortableIds = selectedIds.slice(0, MAX_CLASSIFY_PER_PASS);

  const markSelectedDone = (done: boolean) => {
    setManyDone(selectedIds, done);
    clearSelection();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {selectedCount > 0 && (
        <ConversationSelectionBar
          selectedCount={actionableCount}
          visibleCount={orderedIds.length}
          allVisibleSelected={actionableCount === orderedIds.length}
          isClassifying={isClassifying}
          exceedsPassCap={actionableCount > MAX_CLASSIFY_PER_PASS}
          onSelectAllVisible={() => selectAll(orderedIds)}
          onClear={clearSelection}
          onMarkDone={() => markSelectedDone(true)}
          onMarkNotDone={() => markSelectedDone(false)}
          onSortSelected={() => classify({ kind: "selection", sessionIds: sortableIds })}
        />
      )}

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
                    onPointerDownCapture={(event) => {
                      rangeIntent.current = event.shiftKey;
                    }}
                    onKeyDownCapture={(event) => {
                      rangeIntent.current = event.shiftKey;
                    }}
                    className={cn(
                      "flex items-start gap-2 px-3 py-2 transition-colors hover:bg-muted/60",
                      row.done && "opacity-50",
                      row.selected && "bg-muted/40",
                    )}
                  >
                    <Checkbox
                      checked={row.selected}
                      onCheckedChange={(checked) => {
                        const range = rangeIntent.current && checked === true;
                        rangeIntent.current = false;

                        if (range) {
                          selectRange(
                            rows.map((sibling) => sibling.sessionId),
                            row.sessionId,
                          );
                          return;
                        }
                        setSelected(row.sessionId, checked === true);
                      }}
                      aria-label={i18n._({
                        id: "conversations.row.select",
                        message: "Select conversation",
                      })}
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
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      aria-pressed={row.done}
                      aria-label={
                        row.done
                          ? i18n._({
                              id: "conversations.selection.mark_not_done",
                              message: "Mark as not done",
                            })
                          : i18n._({
                              id: "conversations.selection.mark_done",
                              message: "Mark as done",
                            })
                      }
                      onClick={() => setDone(row.sessionId, !row.done)}
                    >
                      <CheckCheckIcon
                        className={cn(
                          "h-3 w-3",
                          row.done ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                    </Button>
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

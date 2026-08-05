import { useLingui } from "@lingui/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCheckIcon, MessageSquareIcon } from "lucide-react";
import { type FC, useEffect, useRef } from "react";
import { useConversationSelection } from "@/lib/atoms/conversationSelection";
import { useDoneConversations } from "@/lib/atoms/doneConversations";
import { useViewMode } from "@/lib/atoms/viewMode";
import { formatLocaleDate } from "@/lib/date/formatLocaleDate";
import { MAX_CLASSIFY_PER_PASS } from "@/lib/topics/classifyLimits";
import { ConversationSelectionBar } from "@/web/components/conversations/ConversationSelectionBar";
import { CopySessionIdButton } from "@/web/components/CopySessionIdButton";
import { TopicIcon } from "@/web/components/TopicIcon";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent } from "@/web/components/ui/card";
import { Checkbox } from "@/web/components/ui/checkbox";
import { conversationListQuery } from "@/web/lib/api/queries";
import { useClassifyTopics } from "@/web/lib/api/useClassifyTopics";
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
  const { i18n } = useLingui();
  const { isDone, setDone, setManyDone } = useDoneConversations();
  const {
    isSelected,
    setSelected,
    selectRange,
    selectAll,
    clearSelection,
    selectedInOrder,
    selectedCount,
  } = useConversationSelection();
  const classify = useClassifyTopics();

  /**
   * Radix's checkbox reports a new checked state, not the event that caused it,
   * so the modifier has to be captured on the way down. Capturing it beats
   * intercepting the click: it also covers shift+space from the keyboard.
   */
  const rangeIntent = useRef(false);

  // A selection is the scope of an action on this list. Leaving the list ends it.
  useEffect(() => clearSelection, [clearSelection]);

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
      selected: isSelected(conversation.sessionId),
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

  /** Visible order. A bulk action never touches a row the filters hid. */
  const orderedIds = rows.map((row) => row.sessionId);
  const selectedIds = selectedInOrder(orderedIds);

  const onRowCheckedChange = (sessionId: string, checked: boolean) => {
    if (rangeIntent.current && checked) {
      selectRange(orderedIds, sessionId);
      return;
    }
    setSelected(sessionId, checked);
  };

  const markSelectedDone = (done: boolean) => {
    setManyDone(selectedIds, done);
    clearSelection();
  };

  return (
    <div className="space-y-4">
      {selectedCount > 0 && (
        <ConversationSelectionBar
          selectedCount={selectedCount}
          visibleCount={rows.length}
          allVisibleSelected={selectedIds.length === rows.length}
          isClassifying={classify.isPending}
          exceedsPassCap={selectedIds.length > MAX_CLASSIFY_PER_PASS}
          onSelectAllVisible={() => selectAll(orderedIds)}
          onClear={clearSelection}
          onMarkDone={() => markSelectedDone(true)}
          onMarkNotDone={() => markSelectedDone(false)}
          onSortSelected={() => classify.mutate({ kind: "selection", sessionIds: selectedIds })}
        />
      )}

      <p className="text-xs text-muted-foreground">
        {rows.length} of {total} conversations
      </p>

      <div
        onPointerDownCapture={(event) => {
          rangeIntent.current = event.shiftKey;
        }}
        onKeyDownCapture={(event) => {
          rangeIntent.current = event.shiftKey;
        }}
        className={cn(
          viewMode === "grid"
            ? "grid gap-4 md:grid-cols-2 lg:grid-cols-3"
            : "flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden",
        )}
      >
        {rows.map((row) => {
          const selectCheckbox = (
            <Checkbox
              checked={row.selected}
              onCheckedChange={(checked) => onRowCheckedChange(row.sessionId, checked === true)}
              aria-label={i18n._({
                id: "conversations.row.select",
                message: "Select conversation",
              })}
              className="shrink-0"
            />
          );

          const doneLabel = row.done
            ? i18n._({ id: "conversations.selection.mark_not_done", message: "Mark as not done" })
            : i18n._({ id: "conversations.selection.mark_done", message: "Mark as done" });

          const doneToggle = (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              aria-pressed={row.done}
              aria-label={doneLabel}
              title={doneLabel}
              onClick={() => setDone(row.sessionId, !row.done)}
            >
              <CheckCheckIcon
                className={cn("h-3.5 w-3.5", row.done ? "text-primary" : "text-muted-foreground")}
              />
            </Button>
          );

          if (viewMode === "grid") {
            return (
              <Card
                key={row.sessionId}
                className={cn(
                  "h-full transition-shadow hover:shadow-md",
                  row.done && "opacity-50",
                  row.selected && "ring-1 ring-primary",
                )}
              >
                <CardContent className="flex h-full flex-col gap-2 py-4">
                  <div className="flex items-start gap-2">
                    {selectCheckbox}
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
                    {doneToggle}
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
                row.selected && "bg-muted/40",
              )}
            >
              {selectCheckbox}
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
              {doneToggle}
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

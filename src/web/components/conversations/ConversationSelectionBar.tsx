import { Trans, useLingui } from "@lingui/react";
import { CheckCheckIcon, Loader2Icon, SparklesIcon, XIcon } from "lucide-react";
import type { FC } from "react";
import { MAX_CLASSIFY_PER_PASS } from "@/lib/topics/classifyLimits";
import { Button } from "@/web/components/ui/button";

/**
 * What can be done to the conversations the user picked out.
 *
 * Presentational on purpose: the lists own the selection and the row order, and
 * both of them render this same bar, so the actions cannot drift between views.
 */
type Props = {
  selectedCount: number;
  visibleCount: number;
  allVisibleSelected: boolean;
  isClassifying: boolean;
  /** More was picked than one pass will take. Said before the click, not after. */
  exceedsPassCap: boolean;
  onSelectAllVisible: () => void;
  onClear: () => void;
  onMarkDone: () => void;
  onMarkNotDone: () => void;
  onSortSelected: () => void;
};

export const ConversationSelectionBar: FC<Props> = ({
  selectedCount,
  visibleCount,
  allVisibleSelected,
  isClassifying,
  exceedsPassCap,
  onSelectAllVisible,
  onClear,
  onMarkDone,
  onMarkNotDone,
  onSortSelected,
}) => {
  const { i18n } = useLingui();

  return (
    <div
      data-testid="conversation-selection-bar"
      className="sticky top-0 z-20 mb-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-background/95 px-3 py-2 backdrop-blur"
    >
      <span data-testid="conversation-selection-count" className="text-xs font-medium">
        {i18n._({
          id: "conversations.selection.count",
          message: "{count} selected",
          values: { count: selectedCount },
        })}
      </span>

      {!allVisibleSelected && (
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onSelectAllVisible}>
          {i18n._({
            id: "conversations.selection.select_all",
            message: "Select all {count}",
            values: { count: visibleCount },
          })}
        </Button>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground"
        onClick={onClear}
      >
        <XIcon className="h-3.5 w-3.5" />
        <Trans id="conversations.selection.clear" message="Clear selection" />
      </Button>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {exceedsPassCap && (
          <span data-testid="conversation-selection-cap" className="text-xs text-muted-foreground">
            {i18n._({
              id: "conversations.selection.cap_warning",
              message: "Only the {max} most recent will be sorted this pass",
              values: { max: MAX_CLASSIFY_PER_PASS },
            })}
          </span>
        )}

        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onMarkDone}>
          <CheckCheckIcon className="h-3.5 w-3.5" />
          <Trans id="conversations.selection.mark_done" message="Mark as done" />
        </Button>

        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onMarkNotDone}>
          <Trans id="conversations.selection.mark_not_done" message="Mark as not done" />
        </Button>

        <Button
          data-testid="conversation-selection-sort"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={isClassifying}
          onClick={onSortSelected}
        >
          {isClassifying ? (
            <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <SparklesIcon className="h-3.5 w-3.5" />
          )}
          <Trans id="conversations.selection.sort_selected" message="Sort selected into topics" />
        </Button>
      </div>
    </div>
  );
};

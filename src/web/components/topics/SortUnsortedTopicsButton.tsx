import { useLingui } from "@lingui/react";
import { useQuery } from "@tanstack/react-query";
import { Loader2Icon, SparklesIcon } from "lucide-react";
import type { FC } from "react";
import { Button } from "@/web/components/ui/button";
import { conversationTopicsPendingQuery } from "@/web/lib/api/queries";
import { useClassifyTopics } from "@/web/lib/api/useClassifyTopics";

/**
 * Files the conversations that have no topic yet, and only those.
 *
 * The count is a cheap query, so this sits on both conversation views rather
 * than only where topics are managed. It shells out to an agent CLI, so a pass
 * takes minutes rather than seconds — hence the explicit button and the running
 * state.
 */
export const SortUnsortedTopicsButton: FC = () => {
  const { i18n } = useLingui();
  const { data } = useQuery(conversationTopicsPendingQuery);
  const unsorted = data?.pending ?? 0;
  const { classify, isClassifying } = useClassifyTopics();

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs"
      disabled={isClassifying || unsorted === 0}
      onClick={() => classify({ kind: "unclassified" })}
      title={i18n._({
        id: "topics.classify.tooltip",
        message: "Ask the agent CLI to file conversations that have no topic yet",
      })}
    >
      {isClassifying ? (
        <Loader2Icon className="w-4 h-4 animate-spin" />
      ) : (
        <SparklesIcon className="w-4 h-4" />
      )}
      {unsorted === 0
        ? i18n._({ id: "topics.classify.all_sorted", message: "Topics sorted" })
        : i18n._({
            id: "topics.classify.sort_unsorted",
            message: "Sort {count} unsorted",
            values: { count: unsorted },
          })}
    </Button>
  );
};

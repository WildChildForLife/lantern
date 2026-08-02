import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, SparklesIcon } from "lucide-react";
import type { FC } from "react";
import { toast } from "sonner";
import { Button } from "@/web/components/ui/button";
import { honoClient } from "@/web/lib/api/client";
import { conversationTopicsPendingQuery } from "@/web/lib/api/queries";

/**
 * Runs the topic classifier over conversations that do not have a topic yet.
 * It shells out to the Claude Code CLI on the server, so a pass takes minutes
 * rather than seconds - hence the explicit button and the running state.
 */
export const ClassifyTopicsButton: FC = () => {
  const queryClient = useQueryClient();
  const { data } = useQuery(conversationTopicsPendingQuery);
  const pending = data?.pending ?? 0;

  const classify = useMutation({
    mutationFn: async (force: boolean) => {
      const response = await honoClient.api.conversations.topics.classify.$post({
        query: force ? { force: "true" } : {},
      });

      if (!response.ok) {
        throw new Error(`Classification failed: ${response.statusText}`);
      }

      return await response.json();
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });

      if (result.failed) {
        toast.error(
          `Classified ${result.classified}, then stopped early. ${result.remaining} left.`,
        );
        return;
      }

      const cost = result.costUsd > 0 ? ` (${result.costUsd.toFixed(3)} USD of usage)` : "";

      toast.success(
        result.classified === 0
          ? "Every conversation already has a topic"
          : `Sorted ${result.classified} conversations into topics${cost}`,
      );
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Classification failed");
    },
  });

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={classify.isPending || pending === 0}
        onClick={() => classify.mutate(false)}
        title="Ask Claude to file the new conversations under a topic"
      >
        {classify.isPending ? (
          <Loader2Icon className="w-4 h-4 animate-spin" />
        ) : (
          <SparklesIcon className="w-4 h-4" />
        )}
        {pending === 0 ? "Topics sorted" : `Sort ${pending} new`}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground"
        disabled={classify.isPending}
        onClick={() => classify.mutate(true)}
        title="Throw away every topic and classify all conversations again"
      >
        Redo all
      </Button>
    </div>
  );
};

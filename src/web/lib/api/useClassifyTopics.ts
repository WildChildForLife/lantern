import { useLingui } from "@lingui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useConversationSelection } from "@/lib/atoms/conversationSelection";
import { type ClassifyRequest, requestClassification } from "@/web/lib/api/classifyTopics";
import { describeClassifyOutcome } from "@/web/lib/classifyOutcome";

/**
 * The one place a classification result turns into words.
 *
 * Both header buttons and the selection bar go through it, so what a pass says
 * about itself cannot depend on which button started it.
 */
export const useClassifyTopics = () => {
  const queryClient = useQueryClient();
  const { i18n } = useLingui();
  const { clearSelection } = useConversationSelection();

  return useMutation({
    mutationFn: (request: ClassifyRequest) => requestClassification(request),
    onSuccess: async (result) => {
      // Prefix-invalidates the list, the topic groups and the pending count: a
      // conversation that just got a topic moves between all three.
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      clearSelection();

      const outcome = describeClassifyOutcome(result);

      if (outcome.kind === "stopped-early") {
        toast.error(
          i18n._({
            id: "topics.classify.toast.stopped_early",
            message: "Sorted {count}, then stopped early. {remaining} still have no topic.",
            values: { count: outcome.classified, remaining: outcome.remaining },
          }),
        );
        return;
      }

      if (outcome.kind === "nothing-to-do") {
        toast.success(
          i18n._({
            id: "topics.classify.toast.none",
            message: "Every conversation already has a topic",
          }),
        );
        return;
      }

      const sorted =
        outcome.costUsd > 0
          ? i18n._({
              id: "topics.classify.toast.sorted_with_cost",
              message: "Sorted {count} conversations into topics ({cost} USD of usage)",
              values: { count: outcome.classified, cost: outcome.costUsd.toFixed(3) },
            })
          : i18n._({
              id: "topics.classify.toast.sorted",
              message: "Sorted {count} conversations into topics",
              values: { count: outcome.classified },
            });

      const leftOver =
        outcome.leftOver === 0
          ? ""
          : ` ${i18n._({
              id: "topics.classify.toast.left_over",
              message: "{count} were left for the next pass",
              values: { count: outcome.leftOver },
            })}`;

      toast.success(`${sorted}${leftOver}`);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : i18n._({ id: "topics.classify.toast.failed", message: "Classification failed" }),
      );
    },
  });
};

import { useLingui } from "@lingui/react";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useConversationSelection } from "@/lib/atoms/conversationSelection";
import {
  ClassificationRequestError,
  type ClassifyRequest,
  requestClassification,
} from "@/web/lib/api/classifyTopics";
import { describeClassifyOutcome } from "@/web/lib/classifyOutcome";

/**
 * Shared by every button that can start a pass, so React Query reports one of
 * them running to all of them. Without it each call site had its own
 * `isPending` and you could start a sort and then wipe every topic underneath
 * it with "Redo all".
 */
const CLASSIFY_MUTATION_KEY = ["conversations", "topics", "classify"] as const;

/**
 * The one place a classification result turns into words.
 *
 * Both header buttons and the selection bar go through it, so what a pass says
 * about itself cannot depend on which button started it.
 */
export const useClassifyTopics = () => {
  const queryClient = useQueryClient();
  const { i18n } = useLingui();
  const { deselect, clearSelection } = useConversationSelection();

  const mutation = useMutation({
    mutationKey: CLASSIFY_MUTATION_KEY,
    mutationFn: (request: ClassifyRequest) => requestClassification(request),
    onSuccess: async (result, request) => {
      // Prefix-invalidates the list, the topic groups and the pending count: a
      // conversation that just got a topic moves between all three.
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });

      // Only the conversations this pass covered leave the selection. Anything
      // the cap left behind stays picked, so pressing again continues.
      if (request.kind === "selection") {
        deselect(request.sessionIds);
      } else {
        clearSelection();
      }

      const outcome = describeClassifyOutcome(result, request.kind);

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

      if (outcome.kind === "nothing-matched") {
        toast.warning(
          i18n._({
            id: "topics.classify.toast.nothing_matched",
            message: "None of the selected conversations could be sorted",
          }),
        );
        return;
      }

      toast.success(
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
            }),
      );

      // A second toast rather than a sentence glued onto the first: the joining
      // word and the order are not the same in every language.
      if (outcome.leftOver > 0) {
        toast.info(
          i18n._({
            id: "topics.classify.toast.left_over",
            message: "{count} were left for the next pass",
            values: { count: outcome.leftOver },
          }),
        );
      }
    },
    onError: (error) => {
      toast.error(
        error instanceof ClassificationRequestError
          ? i18n._({
              id: "topics.classify.toast.failed_status",
              message: "Classification failed ({status})",
              values: { status: error.status },
            })
          : i18n._({ id: "topics.classify.toast.failed", message: "Classification failed" }),
      );
    },
  });

  // Any pass, started anywhere, blocks every button.
  const isClassifying = useIsMutating({ mutationKey: CLASSIFY_MUTATION_KEY }) > 0;

  return { classify: mutation.mutate, isClassifying };
};

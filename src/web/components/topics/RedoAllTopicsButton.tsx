import { Trans, useLingui } from "@lingui/react";
import type { FC } from "react";
import { Button } from "@/web/components/ui/button";
import { useClassifyTopics } from "@/web/lib/api/useClassifyTopics";

/**
 * Throws every stored topic away and files everything again.
 *
 * Lives on the topics page only: it is the one classification action that spends
 * a CLI call on conversations that were already filed, so it belongs where
 * topics are managed rather than beside a list of conversations.
 */
export const RedoAllTopicsButton: FC = () => {
  const { i18n } = useLingui();
  const { classify, isClassifying } = useClassifyTopics();

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs text-muted-foreground"
      disabled={isClassifying}
      onClick={() => classify({ kind: "all" })}
      title={i18n._({
        id: "topics.classify.redo_all_tooltip",
        message: "Throw away every topic and classify all conversations again",
      })}
    >
      <Trans id="topics.classify.redo_all" message="Redo all" />
    </Button>
  );
};

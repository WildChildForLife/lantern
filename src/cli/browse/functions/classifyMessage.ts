import type { ClassifyOutcome } from "../../../lib/topics/classifyOutcome.ts";
import type { Status } from "../components/StatusBar.tsx";

/**
 * One line for what a classification pass did.
 *
 * The web app has room for two toasts and says the leftovers in the second one;
 * a status bar has one line, so the sentences are joined here instead. Kept pure
 * and apart from the component for the same reason the web version is: what a
 * pass claims about itself is worth testing without a screen in the way.
 *
 * English only, like the rest of the CLI — lingui covers the web bundle, and
 * wiring its runtime into this one is separate work.
 */
export const describeClassifyStatus = (outcome: ClassifyOutcome): Status => {
  switch (outcome.kind) {
    case "stopped-early":
      return {
        // What went wrong first, when the pass knows: a count says a pass
        // failed, and only the reason says what to do about it.
        text:
          outcome.reason === null
            ? `Sorted ${outcome.classified}, then stopped early. ${outcome.remaining} still have no topic.`
            : `${outcome.reason}. ${outcome.remaining} still have no topic.`,
        tone: "error",
      };
    case "nothing-to-do":
      return { text: "Every conversation already has a topic.", tone: "ok" };
    case "nothing-matched":
      return { text: "None of those conversations could be sorted.", tone: "error" };
    case "sorted": {
      const cost = outcome.costUsd > 0 ? ` (${outcome.costUsd.toFixed(3)} USD of usage)` : "";
      const leftOver =
        outcome.leftOver > 0 ? ` ${outcome.leftOver} were left for the next pass.` : "";

      return {
        text: `Sorted ${outcome.classified} into topics${cost}.${leftOver}`,
        tone: "ok",
      };
    }
    default:
      outcome satisfies never;
      return null;
  }
};

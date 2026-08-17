import type { ClassificationFailure } from "./runClassificationBatches.ts";

/** As much of a CLI's complaint as a one-line status bar can carry. */
const MAX_DETAIL_LENGTH = 160;

/**
 * Why a pass stopped, in words a user can act on.
 *
 * A pass that could not reach the CLI and a pass that reached it and got
 * nonsense back both used to report themselves as a count: "Sorted 0, then
 * stopped early." That is the number, not the reason, and the reason — most
 * often that `claude` is installed under a node version Lantern is not running
 * on — was only ever written to a log the board draws over.
 */
export const classifyFailureMessage = (
  failure: ClassificationFailure | null,
  detail: string | null,
): string | null => {
  switch (failure) {
    case null:
      return null;
    case "unusable-answer":
      return "The agent CLI answered with nothing that could be read as topics";
    case "cli-unavailable": {
      // Command failures arrive as several lines of stderr. The first line is
      // the one that names the problem; the rest is the transcript.
      const firstLine = (detail ?? "").split("\n")[0]?.trim() ?? "";

      return firstLine === ""
        ? "The agent CLI could not be run"
        : firstLine.slice(0, MAX_DETAIL_LENGTH);
    }
    default:
      failure satisfies never;
      return null;
  }
};

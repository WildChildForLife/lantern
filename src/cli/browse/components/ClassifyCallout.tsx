import { Box, Text } from "ink";
import { theme } from "../../ui/theme.ts";

/** Rows the callout takes, so the board can leave room for it. */
export const CLASSIFY_CALLOUT_HEIGHT = 2;

type ClassifyCalloutProps = {
  /** How many conversations have no topic at all. */
  unclassified: number;
  /** Whether a pass is running right now. */
  classifying: boolean;
};

/**
 * The one line on the board that asks for something rather than reporting it.
 *
 * Sorting is not another way to move around: it calls the configured agent CLI,
 * costs a pass, and changes which column half the board's conversations live in.
 * Listed among the movement keys it read as one of them — so it gets its own row,
 * its own colour and the key drawn as a key.
 *
 * It disappears when there is nothing to sort. A standing invitation to spend a
 * CLI call on an empty pass is worse than no invitation at all.
 */
export const ClassifyCallout = ({ unclassified, classifying }: ClassifyCalloutProps) => {
  if (classifying) {
    return (
      <Box>
        <Text color={theme.accent}>⟳ </Text>
        <Text color={theme.accent} bold>
          sorting into topics…
        </Text>
        <Text dimColor> asking the configured agent CLI; this can take a while</Text>
      </Box>
    );
  }

  if (unclassified <= 0) {
    return null;
  }

  return (
    <Box>
      <Text color={theme.accent} inverse bold>
        {" t "}
      </Text>
      <Text color={theme.accent} bold>
        {" "}
        sort {unclassified} {unclassified === 1 ? "conversation" : "conversations"} into topics
      </Text>
      <Text dimColor> with the AI · T redoes every topic</Text>
    </Box>
  );
};

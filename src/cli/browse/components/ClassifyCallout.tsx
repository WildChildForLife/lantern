import { Box, Text } from "ink";
import { theme } from "../../ui/theme.ts";

/** Rows the callout takes, so the board can leave room for it. */
export const CLASSIFY_CALLOUT_HEIGHT = 2;

type ClassifyCalloutProps = {
  /** How many conversations have no topic at all. */
  unclassified: number;
  /** Whether a pass is running right now. */
  classifying: boolean;
  /**
   * The width to stay inside.
   *
   * The board sets aside one row for this and a blank line under it, and nothing
   * more — so a narrow terminal has to lose the tail of the sentence rather than
   * take a second row that would come out of the conversations.
   */
  width: number;
};

/** The key, drawn as a key rather than as another word in a sentence. */
const Key = ({ label }: { label: string }) => (
  <Text color={theme.accent} inverse bold>
    {` ${label} `}
  </Text>
);

/**
 * The one line on the board that asks for something rather than reporting it.
 *
 * Sorting is not another way to move around: it calls the configured agent CLI,
 * costs a pass, and changes which column half the board's conversations live in.
 * Listed among the movement keys it read as one of them — so it gets its own row,
 * its own colour and the key drawn as a key.
 *
 * The row is always here, whatever the state. Hiding it when there was nothing
 * pending was the first thing tried and it was a mistake: a key nobody can find
 * until the day it becomes relevant is a key nobody knows exists. What changes
 * with the state is which key it leads with — `t` when there is something to
 * sort, `T` when the only sort left to do is a re-sort of everything.
 */
export const ClassifyCallout = ({ unclassified, classifying, width }: ClassifyCalloutProps) => {
  /*
    One truncating Text with the rest nested inside it, not a row of siblings.
    Siblings are measured and wrapped one at a time, so on a narrow terminal this
    row became two — and the second one came out of the board's budget, which is
    counted to the row.
  */
  if (classifying) {
    return (
      <Box width={width}>
        <Text wrap="truncate">
          <Text color={theme.accent} bold>
            ⟳ sorting into topics…
          </Text>
          <Text dimColor> asking the configured agent CLI; this can take a while</Text>
        </Text>
      </Box>
    );
  }

  // Nothing pending. Still says where sorting lives, but leads with the key that
  // would actually do something rather than inviting an empty pass.
  if (unclassified <= 0) {
    return (
      <Box width={width}>
        <Text wrap="truncate">
          <Text color={theme.ok}>✓ </Text>
          <Text dimColor>every conversation has a topic · </Text>
          <Key label="T" />
          <Text dimColor> re-sorts all of them with the AI</Text>
        </Text>
      </Box>
    );
  }

  return (
    <Box width={width}>
      <Text wrap="truncate">
        <Key label="t" />
        <Text color={theme.accent} bold>
          {" "}
          sort {unclassified} {unclassified === 1 ? "conversation" : "conversations"} into topics
        </Text>
        <Text dimColor> with the AI · T redoes every topic</Text>
      </Text>
    </Box>
  );
};

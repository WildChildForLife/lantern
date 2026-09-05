import { Box, Text } from "ink";
import { theme } from "../../ui/theme.ts";

/**
 * Rows the question takes, so the board can leave room for it.
 *
 * Border 2, heading 1, the explanation over two lines, a blank line, the keys, and
 * the margin above the box. Counted generously: one row too many costs a
 * conversation off the bottom of a column, one too few costs the status bar.
 */
export const CONFIRM_RESORT_HEIGHT = 8;

/**
 * The one question the board asks before doing something.
 *
 * Redoing every topic throws away topics the user has already paid an agent CLI
 * for and pays for them again, and a terminal has no undo and no tooltip to warn
 * with. So `T` asks, and only `y` goes ahead — the web app can afford a button
 * because a button is not a keystroke away from a neighbouring key.
 */
export const ConfirmResort = ({ count, width }: { count: number; width: number }) => (
  // Bounded, because the height above is a promise. Left to size itself, the
  // explanation wrapped to more lines on a narrow terminal than the eight rows
  // the board set aside for it, and the rows came out of the status bar.
  <Box
    flexDirection="column"
    borderStyle="round"
    borderColor={theme.danger}
    paddingX={1}
    width={width}
  >
    <Text bold color={theme.danger} wrap="truncate">
      Throw away every topic and sort again?
    </Text>
    {/*
      Two lines that are always two lines. As one wrapping paragraph it was two
      rows on a wide terminal and four on a narrow one, and the height above is
      counted in rows the board has already given away.
    */}
    <Text dimColor wrap="truncate">
      All {count} conversations go back through the configured agent CLI.
    </Text>
    <Text dimColor wrap="truncate">
      That costs what a pass costs, and anything already filed is filed again.
    </Text>
    <Box marginTop={1}>
      <Text wrap="truncate">
        <Text color={theme.accent}>y</Text>
        <Text dimColor> to go ahead · any other key to leave the topics alone</Text>
      </Text>
    </Box>
  </Box>
);

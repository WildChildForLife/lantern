import { Box, Text } from "ink";
import { shellEscape } from "../../../lib/shell/shellEscape.ts";
import { theme } from "../../ui/theme.ts";
import { useFlash } from "../functions/useFlash.ts";

/**
 * A resume command the user asked to see.
 *
 * `token` is bumped on every `p`, including a second `p` on the same
 * conversation, so the panel can tell "shown again" from "still showing".
 */
export type PrintedCommand = {
  cwd: string;
  text: string;
  token: number;
};

/** How many rows the panel takes, so the board can leave room for it. */
export const PRINTED_COMMAND_HEIGHT = 6;

/**
 * The resume command, kept on screen.
 *
 * Printing used to be the end of the session: the board gave the terminal back
 * and the command was the last thing on the screen. It is shown here instead, so
 * the user can copy it and carry on looking — and pressing `p` on another
 * conversation replaces it rather than stacking up a log of commands nobody
 * asked to keep.
 */
export const PrintedCommandPanel = ({
  printed,
  width,
}: {
  printed: PrintedCommand;
  width: number;
}) => {
  const lit = useFlash(printed.token);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={lit ? theme.accent : theme.muted}
      paddingX={1}
      width={width}
    >
      <Text dimColor wrap="truncate">
        resume command · p on another conversation replaces it
      </Text>
      {/*
        Escaped, like the session id in the command below it. This panel exists to
        be pasted: a project directory with a space in it would break the line, and
        one with a `;` in it would run whatever came after.
      */}
      <Text color={lit ? "cyan" : undefined} dimColor={!lit} wrap="truncate">
        cd {shellEscape(printed.cwd)}
      </Text>
      <Text color={lit ? theme.accent : undefined} dimColor={!lit} wrap="truncate">
        {printed.text}
      </Text>
    </Box>
  );
};

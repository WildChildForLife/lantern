import { Box, Text } from "ink";
import { theme } from "../../ui/theme.ts";

/**
 * The one question the board asks before doing something.
 *
 * Redoing every topic throws away topics the user has already paid an agent CLI
 * for and pays for them again, and a terminal has no undo and no tooltip to warn
 * with. So `T` asks, and only `y` goes ahead — the web app can afford a button
 * because a button is not a keystroke away from a neighbouring key.
 */
export const ConfirmResort = ({ count }: { count: number }) => (
  <Box flexDirection="column" borderStyle="round" borderColor={theme.danger} paddingX={1}>
    <Text bold color={theme.danger}>
      Throw away every topic and sort again?
    </Text>
    <Text dimColor>
      All {count} conversations go back through the configured agent CLI, which costs what a pass
      costs. Anything already filed is filed again.
    </Text>
    <Box marginTop={1}>
      <Text color={theme.accent}>y</Text>
      <Text dimColor> to go ahead · any other key to leave the topics alone</Text>
    </Box>
  </Box>
);

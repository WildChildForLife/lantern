import { Box, Text } from "ink";
import { theme } from "../../ui/theme.ts";

const KEYS: [string, string][] = [
  ["← → h l", "move between topics"],
  ["↑ ↓ j k", "move between conversations"],
  ["g G", "first / last conversation"],
  ["/", "filter by topic, title or project"],
  ["enter", "do the action shown in the header"],
  ["e", "change which action that is"],
  ["R", "resume here, and come back to the board after"],
  ["p", "show the resume command, without leaving"],
  ["c", "copy the conversation id"],
  ["t", "sort the conversations with no topic, using the AI"],
  ["T", "throw every topic away and sort again (asks first)"],
  ["r", "re-read the logs"],
  ["? ", "this list"],
  ["q", "quit"],
];

export const HelpOverlay = () => (
  <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
    <Box marginBottom={1}>
      <Text bold color={theme.accent}>
        Keys
      </Text>
    </Box>
    {KEYS.map(([key, description]) => (
      <Box key={key}>
        <Box width={10}>
          <Text color={theme.accent}>{key}</Text>
        </Box>
        <Text dimColor>{description}</Text>
      </Box>
    ))}
    <Box marginTop={1}>
      <Text dimColor>any key to go back</Text>
    </Box>
  </Box>
);

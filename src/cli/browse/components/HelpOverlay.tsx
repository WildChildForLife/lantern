import { Box, Text } from "ink";
import { theme } from "../../ui/theme.ts";

const KEYS: [string, string][] = [
  ["← → h l", "move between topics"],
  ["↑ ↓ j k", "move between conversations"],
  ["g G", "first / last conversation"],
  ["/", "filter by topic, title or project"],
  ["enter", "what to do with this conversation"],
  ["R", "resume here, replacing this screen"],
  ["o", "open in a new terminal window"],
  ["p", "print the resume command and quit"],
  ["c", "copy the conversation id"],
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

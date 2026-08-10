import { Box, Text } from "ink";
import { theme } from "../../ui/theme.ts";

const KEYS: [string, string][] = [
  ["← → h l", "move between topics"],
  ["↑ ↓ j k", "move between conversations"],
  ["g G", "first / last conversation"],
  ["/", "filter by topic, title or project"],
  ["enter", "do the action shown in the header"],
  ["e", "change which action that is"],
  ["R", "resume here, come back after"],
  ["p", "show the resume command"],
  ["c", "copy the conversation id"],
  ["t", "sort untopiced conversations (AI)"],
  ["T", "redo every topic (asks first)"],
  ["r", "re-read the logs"],
  ["? ", "this list"],
  ["q", "quit"],
];

/**
 * Two columns, not fourteen rows.
 *
 * One key per row came to twenty-one rows with the border and the title, which is
 * taller than a twenty-row terminal has to spare — and the list is most wanted on
 * a small terminal. Split in half it is seven, and the widths were trimmed to
 * match: an entry that wraps costs a row back.
 */
const HALF = Math.ceil(KEYS.length / 2);

const KeyList = ({ entries }: { entries: [string, string][] }) => (
  <Box flexDirection="column" marginRight={2}>
    {entries.map(([key, description]) => (
      <Box key={key}>
        <Box width={9}>
          <Text color={theme.accent}>{key}</Text>
        </Box>
        <Text dimColor wrap="truncate">
          {description}
        </Text>
      </Box>
    ))}
  </Box>
);

export const HelpOverlay = () => (
  <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
    <Box marginBottom={1}>
      <Text bold color={theme.accent}>
        Keys
      </Text>
    </Box>
    <Box>
      <KeyList entries={KEYS.slice(0, HALF)} />
      <KeyList entries={KEYS.slice(HALF)} />
    </Box>
    <Box marginTop={1}>
      <Text dimColor>any key to go back</Text>
    </Box>
  </Box>
);

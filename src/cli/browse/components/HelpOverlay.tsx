import { Box, Text } from "ink";
import { theme } from "../../ui/theme.ts";

const KEYS: [string, string][] = [
  ["← → h l", "move between topics"],
  ["↑ ↓ j k", "move between conversations"],
  ["PgUp PgDn", "a screenful at a time"],
  ["g G", "first / last conversation"],
  ["/", "search titles, projects, topics"],
  ["esc", "clear the search"],
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
 * Two columns, not sixteen rows.
 *
 * One key per row comes to twenty-one rows with the border and the title, which
 * is taller than a twenty-row terminal has to spare — and the list is most wanted
 * on a small terminal. Split in half it is eight rows of keys, thirteen with the
 * border, the title and the way out; an entry that wraps costs a row back, so the
 * halves are clipped rather than allowed to.
 */
const HALF = Math.ceil(KEYS.length / 2);

/** Widest key label in the table, plus the gap before its description. */
const KEY_WIDTH = 10;
/** The gap between the two halves. */
const COLUMN_GAP = 2;
/** The box's border and its horizontal padding. */
const BORDER_WIDTH = 4;

const KeyList = ({ entries, width }: { entries: [string, string][]; width: number }) => (
  <Box flexDirection="column" width={width} marginRight={COLUMN_GAP}>
    {entries.map(([key, description]) => (
      <Box key={key}>
        {/*
          Never shrinks. Squeezed, Yoga took the key column first, which ran the
          key into its own description — `enterdo the action…` — and a key list
          whose keys are unreadable has nothing left to be. The description is
          the half that clips.
        */}
        <Box width={KEY_WIDTH} flexShrink={0}>
          <Text color={theme.accent} wrap="truncate">
            {key}
          </Text>
        </Box>
        <Text dimColor wrap="truncate">
          {description}
        </Text>
      </Box>
    ))}
  </Box>
);

/**
 * The key list, sized to the terminal it is drawn in.
 *
 * Every row here is clipped rather than wrapped, and the halves are given
 * explicit widths to clip against: the overlay's height is what decides whether
 * the status bar under it stays on the screen, and a wrapped entry on a narrow
 * terminal quietly adds a row to it.
 */
export const HelpOverlay = ({ width }: { width: number }) => {
  const half = Math.max(KEY_WIDTH + 1, Math.floor((width - BORDER_WIDTH - COLUMN_GAP) / 2));

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accent}
      paddingX={1}
      width={width}
    >
      <Box marginBottom={1}>
        <Text bold color={theme.accent}>
          Keys
        </Text>
      </Box>
      <Box>
        <KeyList entries={KEYS.slice(0, HALF)} width={half} />
        <KeyList entries={KEYS.slice(HALF)} width={half} />
      </Box>
      <Box marginTop={1}>
        <Text dimColor wrap="truncate">
          any key to go back
        </Text>
      </Box>
    </Box>
  );
};

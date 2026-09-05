import { Box, Text } from "ink";
import { TextInput } from "../../ui/prompts/TextInput.tsx";
import { theme } from "../../ui/theme.ts";
import { truncateToWidth } from "../functions/formatRow.ts";

/** The bar, plus the blank line under it. Drawn in every mode, so always spent. */
export const SEARCH_BAR_HEIGHT = 2;

/** Below this the bar is the badge and the query, and nothing else fits beside them. */
const HINT_MIN_WIDTH = 64;

const BADGE = " ⌕ SEARCH ";
/** The badge, the space after it, and the field's own `❯ ` and caret. */
const BADGE_WIDTH = BADGE.length + 1;
const FIELD_CHROME_WIDTH = 3;

type SearchBarProps = {
  /** Whether the bar has the keyboard, rather than the board. */
  active: boolean;
  filter: string;
  /** Conversations the current query left on the board. */
  matchCount: number;
  width: number;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
};

const describeMatches = (count: number): string =>
  count === 0 ? "no matches" : count === 1 ? "1 match" : `${count} matches`;

/**
 * The board's search, given a permanent place on the screen.
 *
 * It used to be a prefix that appeared while it was being typed into and went
 * away again on Enter, which left the board quietly filtered by a query with
 * nothing on screen to say so — and left a feature most people never found
 * advertised only in the key list. So the bar is always drawn, in the same
 * place, whether or not anything has been typed: idle it says which key opens
 * it, filtered it holds the query and the count, and it costs the same two rows
 * throughout so the board below it never jumps.
 */
export const SearchBar = ({
  active,
  filter,
  matchCount,
  width,
  onChange,
  onSubmit,
  onCancel,
}: SearchBarProps) => {
  const hint = active
    ? `${describeMatches(matchCount)} · enter keep · esc clear`
    : `${describeMatches(matchCount)} · / edit · esc clear`;

  /*
    Sized here rather than left to the flexbox, because the one thing this bar
    must never do is take a second line: the board below it is budgeted to the
    rows the terminal has, and a wrapped bar takes the status bar off the bottom
    of the screen. So the hint is dropped on a narrow terminal and the query is
    clipped to whatever is left over.
  */
  const showHint = width >= HINT_MIN_WIDTH && (active || filter !== "");
  const hintWidth = showHint ? hint.length + 1 : 0;
  const middleWidth = Math.max(1, width - BADGE_WIDTH - hintWidth);

  return (
    <Box width={width} marginBottom={1}>
      {/*
        Reversed out rather than merely coloured. Everything else on the board is
        a coloured word on the terminal's own background, so a filled label is the
        one thing on screen that cannot be mistaken for another row of text.
      */}
      <Text backgroundColor={theme.accent} color="black" bold>
        {BADGE}
      </Text>
      <Text> </Text>

      <Box width={middleWidth}>
        {active ? (
          <TextInput
            initialValue={filter}
            visibleWidth={Math.max(1, middleWidth - FIELD_CHROME_WIDTH)}
            onChange={onChange}
            onSubmit={onSubmit}
            onCancel={onCancel}
          />
        ) : filter === "" ? (
          <Text dimColor wrap="truncate">
            {truncateToWidth("press / to search titles, projects and topics", middleWidth)}
          </Text>
        ) : (
          <Text wrap="truncate">
            <Text color={theme.accent}>❯ </Text>
            {truncateToWidth(filter, Math.max(1, middleWidth - 2))}
          </Text>
        )}
      </Box>

      {showHint ? (
        <Box flexGrow={1} justifyContent="flex-end">
          <Text dimColor wrap="truncate">
            {hint}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
};

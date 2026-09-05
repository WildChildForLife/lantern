import { Box, Text } from "ink";
import { theme } from "../../ui/theme.ts";
import type { BoardRow } from "../functions/buildColumns.ts";
import { highlightSpans } from "../functions/formatRow.ts";
import { formatRelativeTime } from "../functions/relativeTime.ts";

type ConversationRowProps = {
  row: BoardRow;
  width: number;
  selected: boolean;
  now: Date;
};

/** Width the age column reserves, plus the space in front of it. */
const AGE_WIDTH = 5;

export const ConversationRow = ({ row, width, selected, now }: ConversationRowProps) => {
  const age = formatRelativeTime(row.lastModifiedAt, now);
  const titleWidth = Math.max(1, width - AGE_WIDTH - 2);
  const segments = highlightSpans(row.displayTitle, row.titleSpans, titleWidth);

  return (
    <Box width={width}>
      <Box width={2}>
        <Text color={selected ? "yellow" : undefined}>{selected ? "❯" : " "}</Text>
      </Box>
      <Box width={titleWidth}>
        {/*
          One Text, however many segments: the row is truncated by the box it is
          drawn in, and separate Texts would each be measured and wrapped on their
          own — which puts the tail of a long title on a second line and takes the
          column's grid with it.

          Underlined as well as coloured, because the selected row is already
          bold and inverted: accent on an inverted background is the one
          combination that disappears, and bold inside bold is no difference at
          all. The underline is what survives both.
        */}
        <Text bold={selected} inverse={selected} wrap="truncate">
          {segments.map((segment, index) => (
            <Text
              // Segments have no identity beyond where they fall in the title.
              key={`${index}-${segment.text}`}
              bold={segment.matched}
              underline={segment.matched}
              color={segment.matched && !selected ? theme.accent : undefined}
            >
              {segment.text}
            </Text>
          ))}
        </Text>
      </Box>
      <Box width={AGE_WIDTH} justifyContent="flex-end">
        <Text dimColor>{age}</Text>
      </Box>
    </Box>
  );
};

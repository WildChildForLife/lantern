import { Box, Text } from "ink";
import type { BoardRow } from "../functions/buildColumns.ts";
import { truncateToWidth } from "../functions/formatRow.ts";
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
  const title = truncateToWidth(row.displayTitle, titleWidth);

  return (
    <Box width={width}>
      <Box width={2}>
        <Text color={selected ? "yellow" : undefined}>{selected ? "❯" : " "}</Text>
      </Box>
      <Box width={titleWidth}>
        <Text bold={selected} inverse={selected} wrap="truncate">
          {title}
        </Text>
      </Box>
      <Box width={AGE_WIDTH} justifyContent="flex-end">
        <Text dimColor>{age}</Text>
      </Box>
    </Box>
  );
};

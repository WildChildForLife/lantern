import { Box, Text } from "ink";
import { topicColor, topicGlyph } from "../../ui/theme.ts";
import type { BoardColumn } from "../functions/buildColumns.ts";
import { truncateToWidth } from "../functions/formatRow.ts";
import { resolveWindow } from "../functions/layout.ts";
import { ConversationRow } from "./ConversationRow.tsx";

type TopicColumnProps = {
  column: BoardColumn;
  width: number;
  visibleRows: number;
  /** Index of the highlighted row, or null when this column is not focused. */
  selectedRow: number | null;
  now: Date;
};

export const TopicColumn = ({ column, width, visibleRows, selectedRow, now }: TopicColumnProps) => {
  const color = topicColor(column.topic.id);
  const { start, end } = resolveWindow({
    index: selectedRow ?? 0,
    total: column.rows.length,
    size: visibleRows,
  });
  const hiddenAbove = start;
  const hiddenBelow = column.rows.length - end;

  return (
    <Box flexDirection="column" width={width} marginRight={1}>
      {/*
        Truncated by Ink as well as by us: a label of CJK or emoji is twice as wide
        as it is long, so clipping by character count alone lets it wrap and take
        the column's grid with it.
      */}
      <Box>
        <Text color={color} bold={selectedRow !== null} wrap="truncate">
          {topicGlyph(column.topic.icon)} {truncateToWidth(column.topic.label, width - 8)}
        </Text>
        <Text dimColor> {column.rows.length}</Text>
      </Box>
      <Box>
        <Text color={color} dimColor={selectedRow === null}>
          {"─".repeat(Math.max(1, width - 1))}
        </Text>
      </Box>
      {hiddenAbove > 0 ? <Text dimColor> ↑ {hiddenAbove} more</Text> : null}
      {column.rows.slice(start, end).map((row, offset) => (
        <ConversationRow
          key={row.sessionId}
          row={row}
          width={width}
          selected={selectedRow === start + offset}
          now={now}
        />
      ))}
      {hiddenBelow > 0 ? <Text dimColor> ↓ {hiddenBelow} more</Text> : null}
    </Box>
  );
};

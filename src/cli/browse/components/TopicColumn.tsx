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
  /**
   * Where the focused column's window has been scrolled to.
   *
   * Only the column being moved through has one. The others are drawn cold, from
   * the top, because there is no cursor in them to keep on screen.
   */
  windowStart?: number | undefined;
  now: Date;
};

export const TopicColumn = ({
  column,
  width,
  visibleRows,
  selectedRow,
  windowStart,
  now,
}: TopicColumnProps) => {
  const color = topicColor(column.topic.id);
  const total = column.rows.length;
  const start =
    windowStart === undefined || selectedRow === null
      ? resolveWindow({ index: selectedRow ?? 0, total, size: visibleRows }).start
      : Math.min(Math.max(0, windowStart), Math.max(0, total - visibleRows));
  const end = Math.min(total, start + Math.max(0, visibleRows));
  const hiddenAbove = start;
  const hiddenBelow = total - end;
  /**
   * Where you are, not just how many there are. A column that scrolls hides most
   * of itself, and `12/40` is the only thing on screen that says how far down it
   * the cursor has got. The label is clipped around it rather than to a fixed
   * width, so the count never falls off the end of a narrow column.
   */
  const counter =
    selectedRow === null ? `${total}` : `${Math.min(selectedRow + 1, total)}/${total}`;

  return (
    <Box flexDirection="column" width={width} marginRight={1}>
      {/*
        Truncated by Ink as well as by us: a label of CJK or emoji is twice as wide
        as it is long, so clipping by character count alone lets it wrap and take
        the column's grid with it.
      */}
      <Box>
        <Text color={color} bold={selectedRow !== null} wrap="truncate">
          {topicGlyph(column.topic.icon)}{" "}
          {truncateToWidth(column.topic.label, width - counter.length - 5)}
        </Text>
        <Text dimColor> {counter}</Text>
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

import { Box, Text } from "ink";
import { theme, topicColor, topicGlyph } from "../../ui/theme.ts";
import type { BoardColumn } from "../functions/buildColumns.ts";
import { truncateToWidth } from "../functions/formatRow.ts";
import { type Layout, resolveWindow } from "../functions/layout.ts";
import { ConversationRow } from "./ConversationRow.tsx";

type TwoPaneProps = {
  columns: BoardColumn[];
  layout: Layout;
  columnIndex: number;
  rowIndex: number;
  /** Where the conversation pane has been scrolled to. */
  rowStart: number;
  now: Date;
};

/**
 * The narrow-terminal fallback: topics down the left, the selected topic's
 * conversations on the right.
 *
 * Below about ninety columns a board would show one column at a time, which is
 * a list with extra steps. The keys are unchanged — left and right still move
 * between topics — so the two layouts are the same thing at different widths.
 */
export const TwoPane = ({
  columns,
  layout,
  columnIndex,
  rowIndex,
  rowStart,
  now,
}: TwoPaneProps) => {
  const active = columns[columnIndex];
  const topicWindow = resolveWindow({
    index: columnIndex,
    total: columns.length,
    size: layout.visibleRows,
  });

  // The pane is the list being moved through, so it scrolls from a remembered
  // position like the board's focused column does. The rail beside it has no
  // cursor of its own and is drawn cold.
  const total = active?.rows.length ?? 0;
  const start = Math.min(Math.max(0, rowStart), Math.max(0, total - layout.visibleRows));
  const end = Math.min(total, start + Math.max(0, layout.visibleRows));
  const hiddenBelow = total - end;

  return (
    <Box flexDirection="row">
      <Box flexDirection="column" width={layout.railWidth} marginRight={2}>
        {columns.slice(topicWindow.start, topicWindow.end).map((column, offset) => {
          const focused = topicWindow.start + offset === columnIndex;

          return (
            <Box key={column.topic.id}>
              {/* Same reason as the board's labels: Ink measures the display width. */}
              <Text
                color={focused ? topicColor(column.topic.id) : undefined}
                bold={focused}
                wrap="truncate"
              >
                {focused ? "❯ " : "  "}
                {topicGlyph(column.topic.icon)}{" "}
                {truncateToWidth(column.topic.label, layout.railWidth - 8)}
              </Text>
              <Text dimColor> {column.rows.length}</Text>
            </Box>
          );
        })}
      </Box>
      <Box flexDirection="column" width={layout.columnWidth}>
        {active === undefined ? (
          <Text color={theme.muted}>Nothing here.</Text>
        ) : (
          <>
            {/*
              The same markers the board's columns carry. Without them a pane
              that scrolls looks like a pane that has run out of conversations.
            */}
            {start > 0 ? <Text dimColor> ↑ {start} more</Text> : null}
            {active.rows.slice(start, end).map((row, offset) => (
              <ConversationRow
                key={row.sessionId}
                row={row}
                width={layout.columnWidth}
                selected={start + offset === rowIndex}
                now={now}
              />
            ))}
            {hiddenBelow > 0 ? <Text dimColor> ↓ {hiddenBelow} more</Text> : null}
          </>
        )}
      </Box>
    </Box>
  );
};

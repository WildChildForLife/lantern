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
export const TwoPane = ({ columns, layout, columnIndex, rowIndex, now }: TwoPaneProps) => {
  const active = columns[columnIndex];
  const topicWindow = resolveWindow({
    index: columnIndex,
    total: columns.length,
    size: layout.visibleRows,
  });
  const rowWindow = resolveWindow({
    index: rowIndex,
    total: active?.rows.length ?? 0,
    size: layout.visibleRows,
  });

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
          active.rows
            .slice(rowWindow.start, rowWindow.end)
            .map((row, offset) => (
              <ConversationRow
                key={row.sessionId}
                row={row}
                width={layout.columnWidth}
                selected={rowWindow.start + offset === rowIndex}
                now={now}
              />
            ))
        )}
      </Box>
    </Box>
  );
};

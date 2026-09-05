import { Box } from "ink";
import type { BoardColumn } from "../functions/buildColumns.ts";
import { type Layout, resolveWindow } from "../functions/layout.ts";
import { TopicColumn } from "./TopicColumn.tsx";

type BoardProps = {
  columns: BoardColumn[];
  layout: Extract<Layout, { mode: "board" }>;
  columnIndex: number;
  rowIndex: number;
  /** Where the focused column has been scrolled to. */
  rowStart: number;
  now: Date;
};

/** One column per topic, side by side, scrolling sideways past what fits. */
export const Board = ({ columns, layout, columnIndex, rowIndex, rowStart, now }: BoardProps) => {
  const { start, end } = resolveWindow({
    index: columnIndex,
    total: columns.length,
    size: layout.visibleColumns,
  });

  return (
    <Box flexDirection="row">
      {columns.slice(start, end).map((column, offset) => {
        const focused = start + offset === columnIndex;

        return (
          <TopicColumn
            key={column.topic.id}
            column={column}
            width={layout.columnWidth}
            visibleRows={layout.visibleRows}
            selectedRow={focused ? rowIndex : null}
            windowStart={focused ? rowStart : undefined}
            now={now}
          />
        );
      })}
    </Box>
  );
};

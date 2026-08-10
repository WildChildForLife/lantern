import { Box } from "ink";
import type { BoardColumn } from "../functions/buildColumns.ts";
import { type Layout, resolveWindow } from "../functions/layout.ts";
import { TopicColumn } from "./TopicColumn.tsx";

type BoardProps = {
  columns: BoardColumn[];
  layout: Layout;
  columnIndex: number;
  rowIndex: number;
  now: Date;
};

/** One column per topic, side by side, scrolling sideways past what fits. */
export const Board = ({ columns, layout, columnIndex, rowIndex, now }: BoardProps) => {
  const { start, end } = resolveWindow({
    index: columnIndex,
    total: columns.length,
    size: layout.visibleColumns,
  });

  return (
    <Box flexDirection="row">
      {columns.slice(start, end).map((column, offset) => (
        <TopicColumn
          key={column.topic.id}
          column={column}
          width={layout.columnWidth}
          visibleRows={layout.visibleRows}
          selectedRow={start + offset === columnIndex ? rowIndex : null}
          now={now}
        />
      ))}
    </Box>
  );
};

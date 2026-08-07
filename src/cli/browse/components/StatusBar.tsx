import { Box, Text } from "ink";
import { formatCost } from "../../../lib/format/formatCost.ts";
import { theme } from "../../ui/theme.ts";
import type { BoardRow } from "../functions/buildColumns.ts";

export type Status = {
  text: string;
  tone: "ok" | "error" | "info";
} | null;

type StatusBarProps = {
  row: BoardRow | undefined;
  status: Status;
  width: number;
};

const TONE_COLOR = {
  ok: theme.ok,
  error: theme.danger,
  info: theme.muted,
} as const;

/**
 * The line under the board.
 *
 * Everything a row cannot spare the width for — the project, the model, what
 * the conversation cost, its id — lives here for whichever row is selected,
 * so the columns stay scannable.
 */
export const StatusBar = ({ row, status, width }: StatusBarProps) => (
  <Box flexDirection="column" width={width}>
    <Box>
      {status === null ? (
        row === undefined ? (
          <Text dimColor>No conversation selected</Text>
        ) : (
          <Text dimColor wrap="truncate">
            {row.projectPath ?? row.projectName ?? "unknown project"} · {row.source} ·{" "}
            {row.modelName ?? "unknown model"} · {formatCost(row.totalCostUsd, row.costConfidence)}{" "}
            · {row.messageCount} messages · {row.sessionId}
          </Text>
        )
      ) : (
        <Text color={TONE_COLOR[status.tone]}>{status.text}</Text>
      )}
    </Box>
    <Box>
      <Text dimColor>
        ←→ topics · ↑↓ conversations · / filter · enter actions · r refresh · ? keys · q quit
      </Text>
    </Box>
  </Box>
);

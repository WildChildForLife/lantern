import { Box, Text } from "ink";
import { theme } from "../../ui/theme.ts";
import type { BoardRow } from "../functions/buildColumns.ts";
import { statusFields } from "../functions/statusFields.ts";

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
 * The selected conversation's detail, a colour per fact.
 *
 * Which fact gets which colour is `statusFields`' decision; this only draws it,
 * with the separators left dim so they read as structure rather than as another
 * field.
 */
const ConversationDetail = ({ row }: { row: BoardRow }) => (
  <Text wrap="truncate">
    {statusFields(row).map((field, index) => (
      <Text key={field.name}>
        {index === 0 ? "" : <Text dimColor> · </Text>}
        {field.color === null ? (
          <Text dimColor>{field.text}</Text>
        ) : (
          <Text color={field.color}>{field.text}</Text>
        )}
      </Text>
    ))}
  </Text>
);

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
          <ConversationDetail row={row} />
        )
      ) : (
        <Text color={TONE_COLOR[status.tone]}>{status.text}</Text>
      )}
    </Box>
    <Box>
      {/*
        Truncated rather than wrapped: the board is sized to the rows it has been
        left, so a hint line that spills onto a second row pushes the last
        conversation off the bottom of the screen.
      */}
      <Text dimColor wrap="truncate">
        ←→ topics · ↑↓ rows · / filter · enter act · e change · t sort · r reload · ? keys · q quit
      </Text>
    </Box>
  </Box>
);

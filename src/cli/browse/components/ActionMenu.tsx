import { Box, Text } from "ink";
import { formatCost } from "../../../lib/format/formatCost.ts";
import type { ResumeAction } from "../../config/cliConfig.ts";
import { Select, type SelectOption } from "../../ui/prompts/Select.tsx";
import { theme } from "../../ui/theme.ts";
import type { BoardRow } from "../functions/buildColumns.ts";
import { truncateToWidth } from "../functions/formatRow.ts";

type ActionMenuProps = {
  row: BoardRow;
  defaultAction: ResumeAction;
  /** False for a conversation from a CLI Lantern only reads. */
  interactive: boolean;
  onSubmit: (action: ResumeAction) => void;
  onCancel: () => void;
};

const READ_ONLY_REASON = "read-only source";

/**
 * What Enter offers on a conversation.
 *
 * Every action has its own hotkey and works straight from the board too — the
 * menu is for saying which keys exist, not for gating them.
 */
export const ActionMenu = ({
  row,
  defaultAction,
  interactive,
  onSubmit,
  onCancel,
}: ActionMenuProps) => {
  const options: SelectOption<ResumeAction>[] = [
    {
      value: "resume-here",
      label: "Resume here",
      hint: "replaces this screen with the conversation",
      hotkey: "R",
      disabled: !interactive,
      disabledReason: READ_ONLY_REASON,
    },
    {
      value: "new-window",
      label: "Open in a new terminal window",
      hint: "leaves the board where it is",
      hotkey: "o",
      disabled: !interactive,
      disabledReason: READ_ONLY_REASON,
    },
    {
      value: "print",
      label: "Print the command",
      hint: "quits and writes it out to paste",
      hotkey: "p",
      disabled: !interactive,
      disabledReason: READ_ONLY_REASON,
    },
    { value: "copy-id", label: "Copy the conversation id", hotkey: "c" },
  ];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text bold>{truncateToWidth(row.displayTitle, 70)}</Text>
      <Box marginBottom={1}>
        <Text dimColor>
          {row.projectName ?? "unknown project"} · {row.source} ·{" "}
          {formatCost(row.totalCostUsd, row.costConfidence)} · {row.messageCount} messages
        </Text>
      </Box>
      <Select
        options={options}
        initialValue={interactive ? defaultAction : "copy-id"}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
      <Box marginTop={1}>
        <Text dimColor>esc to go back</Text>
      </Box>
    </Box>
  );
};

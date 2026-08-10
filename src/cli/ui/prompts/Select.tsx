import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { theme } from "../theme.ts";

export type SelectOption<Value extends string> = {
  value: Value;
  label: string;
  /** One line of explanation, shown next to the option. */
  hint?: string;
  /** A hotkey that picks this option outright, skipping the cursor. */
  hotkey?: string;
  disabled?: boolean;
  disabledReason?: string;
};

type SelectProps<Value extends string> = {
  options: SelectOption<Value>[];
  initialValue?: Value | undefined;
  onSubmit: (value: Value) => void;
  onCancel?: (() => void) | undefined;
};

const clampIndex = (index: number, length: number): number => {
  if (length === 0) return 0;
  return (index + length) % length;
};

/**
 * A one-of-many prompt.
 *
 * Written here rather than pulled in: the wizard and the board's action menu
 * share one look, and the published Ink components would each need their own
 * escape hatches for hotkeys and disabled rows.
 */
export const Select = <Value extends string>({
  options,
  initialValue,
  onSubmit,
  onCancel,
}: SelectProps<Value>) => {
  const initialIndex = options.findIndex((option) => option.value === initialValue);
  const [index, setIndex] = useState(initialIndex === -1 ? 0 : initialIndex);

  useInput((input, key) => {
    if (key.escape && onCancel !== undefined) {
      onCancel();
      return;
    }

    if (key.upArrow || input === "k") {
      setIndex((current) => clampIndex(current - 1, options.length));
      return;
    }

    if (key.downArrow || input === "j") {
      setIndex((current) => clampIndex(current + 1, options.length));
      return;
    }

    const byHotkey = options.find((option) => option.hotkey === input);
    if (byHotkey !== undefined && byHotkey.disabled !== true) {
      onSubmit(byHotkey.value);
      return;
    }

    if (key.return) {
      const selected = options[index];
      if (selected !== undefined && selected.disabled !== true) {
        onSubmit(selected.value);
      }
    }
  });

  return (
    <Box flexDirection="column">
      {options.map((option, optionIndex) => {
        const active = optionIndex === index;
        const disabled = option.disabled === true;

        return (
          <Box key={option.value}>
            <Text color={active ? theme.accent : undefined} dimColor={disabled}>
              {active ? "❯ " : "  "}
              {option.hotkey === undefined ? "" : `[${option.hotkey}] `}
              {option.label}
            </Text>
            {option.hint === undefined ? null : <Text dimColor> {option.hint}</Text>}
            {disabled && option.disabledReason !== undefined ? (
              <Text dimColor> — {option.disabledReason}</Text>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
};

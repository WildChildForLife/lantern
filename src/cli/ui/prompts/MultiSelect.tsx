import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { theme } from "../theme.ts";

export type MultiSelectOption<Value extends string> = {
  value: Value;
  label: string;
  hint?: string;
};

type MultiSelectProps<Value extends string> = {
  options: MultiSelectOption<Value>[];
  initialSelected?: Value[] | undefined;
  onSubmit: (values: Value[]) => void;
};

/**
 * A pick-several prompt.
 *
 * Submitting nothing is allowed here; whether an empty answer is meaningful is
 * the caller's business, and the sources step turns it back into "Claude Code
 * only" rather than refusing the keypress.
 */
export const MultiSelect = <Value extends string>({
  options,
  initialSelected,
  onSubmit,
}: MultiSelectProps<Value>) => {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Set<Value>>(new Set(initialSelected ?? []));

  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      setIndex((current) => (current - 1 + options.length) % Math.max(1, options.length));
      return;
    }

    if (key.downArrow || input === "j") {
      setIndex((current) => (current + 1) % Math.max(1, options.length));
      return;
    }

    if (input === " ") {
      const option = options[index];
      if (option !== undefined) {
        setSelected((current) => {
          const next = new Set(current);
          if (next.has(option.value)) {
            next.delete(option.value);
          } else {
            next.add(option.value);
          }
          return next;
        });
      }
      return;
    }

    if (key.return) {
      onSubmit(
        options.filter((option) => selected.has(option.value)).map((option) => option.value),
      );
    }
  });

  return (
    <Box flexDirection="column">
      {options.map((option, optionIndex) => {
        const active = optionIndex === index;

        return (
          <Box key={option.value}>
            <Text color={active ? theme.accent : undefined}>
              {active ? "❯ " : "  "}
              {selected.has(option.value) ? "◉ " : "◯ "}
              {option.label}
            </Text>
            {option.hint === undefined ? null : <Text dimColor> {option.hint}</Text>}
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>space to toggle · enter to confirm</Text>
      </Box>
    </Box>
  );
};

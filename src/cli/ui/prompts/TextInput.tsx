import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { theme } from "../theme.ts";

type TextInputProps = {
  /** Shown greyed out, and submitted as-is when the field is left empty. */
  placeholder?: string | undefined;
  initialValue?: string | undefined;
  /** Returns a message when the value cannot be accepted, otherwise null. */
  validate?: ((value: string) => string | null) | undefined;
  onSubmit: (value: string) => void;
  onChange?: ((value: string) => void) | undefined;
  onCancel?: (() => void) | undefined;
};

/**
 * A single-line text field.
 *
 * Editing is deliberately minimal — type, backspace, enter. Anything more
 * (history, word jumps, a cursor that moves) is a readline reimplementation,
 * and none of the questions asked here are long enough to need one.
 */
export const TextInput = ({
  placeholder,
  initialValue,
  validate,
  onSubmit,
  onChange,
  onCancel,
}: TextInputProps) => {
  const [value, setValue] = useState(initialValue ?? "");
  const [error, setError] = useState<string | null>(null);

  const update = (next: string) => {
    setValue(next);
    setError(null);
    onChange?.(next);
  };

  useInput((input, key) => {
    if (key.escape && onCancel !== undefined) {
      onCancel();
      return;
    }

    if (key.return) {
      const submitted = value === "" ? (placeholder ?? "") : value;
      const message = validate?.(submitted) ?? null;
      if (message !== null) {
        setError(message);
        return;
      }
      onSubmit(submitted);
      return;
    }

    if (key.backspace || key.delete) {
      update(value.slice(0, -1));
      return;
    }

    // Control sequences arrive as input too; only printable text belongs here.
    if (input !== "" && !key.ctrl && !key.meta) {
      update(value + input);
    }
  });

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.accent}>❯ </Text>
        {value === "" ? <Text dimColor>{placeholder ?? ""}</Text> : <Text>{value}</Text>}
        <Text color={theme.accent}>▏</Text>
      </Box>
      {error === null ? null : <Text color={theme.danger}>{error}</Text>}
    </Box>
  );
};

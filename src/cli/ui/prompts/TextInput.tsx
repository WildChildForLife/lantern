import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { theme } from "../theme.ts";

type TextInputProps = {
  /** Shown greyed out, and submitted as-is when the field is left empty. */
  placeholder?: string | undefined;
  initialValue?: string | undefined;
  /**
   * Returns a message when the value cannot be accepted, otherwise null. May
   * answer asynchronously, for checks that have to touch the filesystem.
   */
  validate?: ((value: string) => string | null | Promise<string | null>) | undefined;
  /**
   * Columns the value gets, if it has to fit somewhere.
   *
   * The field shows the end of what was typed rather than the start, so the
   * caret stays visible — the same thing a browser's input does, and the only
   * choice that keeps a field usable once the value outgrows the space.
   *
   * Columns rather than characters, and clipped by Ink rather than by us: a
   * query of CJK or emoji is twice as wide as it is long, so slicing it to a
   * character count let it overflow the box and wrap onto a second line — in
   * the search bar, whose whole height is budgeted at one drawn row.
   */
  visibleWidth?: number | undefined;
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
  visibleWidth,
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
      if (validate === undefined) {
        onSubmit(submitted);
        return;
      }

      void Promise.resolve(validate(submitted))
        .then((message) => {
          if (message === null) {
            onSubmit(submitted);
            return;
          }
          setError(message);
        })
        .catch((error: unknown) => {
          setError(String(error));
        });
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
        {value === "" ? (
          <Text dimColor>{placeholder ?? ""}</Text>
        ) : visibleWidth === undefined ? (
          <Text>{value}</Text>
        ) : (
          // `truncate-start` drops the head of the value rather than its tail,
          // which is the only end that can go: the tail is where the caret is.
          // Ink measures the clip in display columns, so a wide character costs
          // the two it actually takes.
          <Box width={Math.max(1, visibleWidth)}>
            <Text wrap="truncate-start">{value}</Text>
          </Box>
        )}
        <Text color={theme.accent}>▏</Text>
      </Box>
      {error === null ? null : <Text color={theme.danger}>{error}</Text>}
    </Box>
  );
};

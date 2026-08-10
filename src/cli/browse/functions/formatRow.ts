const ELLIPSIS = "…";

/**
 * Clips text to a column width, in characters.
 *
 * Counted in code points rather than UTF-16 units: conversation titles carry
 * emoji and CJK, and slicing one of those in half puts a broken character on
 * the screen for the rest of the session.
 *
 * A code point is not always one column — CJK and most emoji occupy two — so this
 * is a bound on characters, not on the space they take. Every caller draws the
 * result inside a fixed-width `<Text wrap="truncate">`, which is what actually
 * holds the grid together: Ink measures display width, and a label of wide
 * characters is clipped by the box rather than allowed to wrap the column.
 */
export const truncateToWidth = (text: string, width: number): string => {
  if (width <= 0) {
    return "";
  }

  const characters = Array.from(text);
  if (characters.length <= width) {
    return text;
  }

  return `${characters.slice(0, width - 1).join("")}${ELLIPSIS}`;
};

const ELLIPSIS = "…";

/**
 * Clips text to a column width.
 *
 * Counted in code points rather than UTF-16 units: conversation titles carry
 * emoji and CJK, and slicing one of those in half puts a broken character on
 * the screen for the rest of the session.
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

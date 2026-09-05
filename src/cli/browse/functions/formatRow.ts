import type { MatchSpan } from "./searchMatch.ts";

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

/** A run of the title, and whether the search is what put it there. */
export type TitleSegment = { text: string; matched: boolean };

/**
 * Splits a title into the parts the search matched and the parts it did not.
 *
 * Clipped first and split second, because the spans are positions in the whole
 * title and the column only ever draws the front of it: a span that starts past
 * the cut has nothing left to point at, and one that straddles it has to lose
 * its tail with the rest. The ellipsis is never part of a match — it stands for
 * the characters that are not there.
 *
 * Always returns at least one segment for a non-empty title, so the caller draws
 * a row the same way whether or not a search is running.
 */
export const highlightSpans = (text: string, spans: MatchSpan[], width: number): TitleSegment[] => {
  const clipped = truncateToWidth(text, width);
  if (clipped === "") {
    return [];
  }

  const characters = Array.from(clipped);
  // Only the characters carried over from the original are still at the
  // positions the spans were measured against.
  const kept = clipped === text ? characters.length : characters.length - 1;

  const segments: TitleSegment[] = [];
  let cursor = 0;

  const take = (end: number, matched: boolean): void => {
    if (end <= cursor) {
      return;
    }

    const slice = characters.slice(cursor, end).join("");
    const open = segments.at(-1);
    if (open !== undefined && open.matched === matched) {
      open.text += slice;
    } else {
      segments.push({ text: slice, matched });
    }

    cursor = end;
  };

  for (const span of spans) {
    if (span.start >= kept) {
      break;
    }

    take(span.start, false);
    take(Math.min(span.end, kept), true);
  }

  take(characters.length, false);

  return segments;
};

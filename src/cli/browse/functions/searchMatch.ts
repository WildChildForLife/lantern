/**
 * Half-open range of matched characters, for the row to highlight.
 *
 * Offsets are **code points** — positions in `Array.from(text)` — not UTF-16
 * indices, and they belong to the exact string the match was scored against. A
 * title with an emoji in it makes the two disagree, so `text.slice(start, end)`
 * is the wrong way to read one; `highlightSpans` is the right way.
 */
export type MatchSpan = { start: number; end: number };

export type MatchResult = {
  /** Higher is a better match. Only ever compared, never displayed. */
  score: number;
  spans: MatchSpan[];
};

export type Query = {
  /** Every term has to match somewhere, so `refund flow` narrows twice. */
  terms: string[];
  caseSensitive: boolean;
};

/** The term found in one piece, which is what most searches are and should win. */
const SUBSTRING_BASE = 100;
/**
 * The term found in order but broken up.
 *
 * Below any one-piece match of the same term against the same field — the bases
 * are far enough apart that no run of bonuses closes the gap. Not below one from
 * a different field: `buildColumns` weights the fields, and a scattered hit in a
 * title routinely and deliberately outranks a contiguous one in a project path.
 */
const SUBSEQUENCE_BASE = 40;
const PREFIX_BONUS = 16;
const WORD_START_BONUS = 12;
/** Paid per character that carried straight on from the one before it. */
const RUN_BONUS = 4;
const GAP_PENALTY = 1;
/** Past this the gap is bad enough that a longer one is not worth measuring. */
const GAP_PENALTY_LIMIT = 8;
/** Same for how late in the text the match starts. */
const LATE_START_LIMIT = 20;

const WORD_SEPARATOR = /[\s\-_/.:,;()[\]{}'"]/;

/**
 * Case-folds a single character without changing how many there are.
 *
 * `toLowerCase` is not length-preserving for every character in Unicode — `İ`
 * lowercases to two code points — and this array is indexed against the original
 * to report where the match was, so a shifted index would highlight the wrong
 * characters. The first code point is close enough for a search box.
 */
const foldChar = (character: string): string => Array.from(character.toLowerCase())[0] ?? character;

const isUpperCase = (character: string): boolean =>
  character !== character.toLowerCase() && character === character.toUpperCase();

const isLowerCase = (character: string): boolean =>
  character !== character.toUpperCase() && character === character.toLowerCase();

/**
 * Whether a character starts a word.
 *
 * A capital counts, not just a separator: `fixAuthBug` is three words to
 * everyone reading it, and searching `auth` should find it as readily as
 * `fix auth bug`.
 */
const startsWord = (characters: string[], index: number): boolean => {
  if (index === 0) {
    return true;
  }

  const previous = characters[index - 1] ?? "";
  const current = characters[index] ?? "";

  return WORD_SEPARATOR.test(previous) || (!isUpperCase(previous) && isUpperCase(current));
};

const startBonus = (characters: string[], index: number): number =>
  index === 0 ? PREFIX_BONUS : startsWord(characters, index) ? WORD_START_BONUS : 0;

/** Turns matched positions into the runs of adjacent characters they form. */
const toSpans = (positions: number[]): MatchSpan[] => {
  const spans: MatchSpan[] = [];

  for (const position of positions) {
    const open = spans.at(-1);
    if (open !== undefined && open.end === position) {
      open.end = position + 1;
      continue;
    }

    spans.push({ start: position, end: position + 1 });
  }

  return spans;
};

/**
 * The best hit with the term's characters all in a row, or null when they are
 * not. Any contiguous run counts, word boundary or not — `oar` is in `board`;
 * what a word boundary buys is a bonus, not admission.
 */
const scoreSubstring = (
  characters: string[],
  folded: string[],
  term: string[],
): MatchResult | null => {
  let best: MatchResult | null = null;

  for (let start = 0; start + term.length <= folded.length; start++) {
    if (term.some((character, offset) => folded[start + offset] !== character)) {
      continue;
    }

    const score =
      SUBSTRING_BASE +
      startBonus(characters, start) +
      (term.length - 1) * RUN_BONUS -
      Math.min(start, LATE_START_LIMIT);

    if (best === null || score > best.score) {
      best = { score, spans: [{ start, end: start + term.length }] };
    }
  }

  return best;
};

/**
 * The term's characters found in order but not together.
 *
 * Greedy left to right, then a pass back along the matches pulling each one
 * forward onto the heels of the next where the text allows it. The second pass
 * earns its keep when a character of the term appears more than once in the
 * text: `ab` against "a x ab" matches greedily at 0 and 5, and the pass pulls it
 * to 4 and 5, which is the run a reader would have picked out.
 */
const scoreSubsequence = (
  characters: string[],
  folded: string[],
  term: string[],
): MatchResult | null => {
  const positions: number[] = [];

  for (let index = 0; index < folded.length && positions.length < term.length; index++) {
    if (folded[index] === term[positions.length]) {
      positions.push(index);
    }
  }

  if (positions.length < term.length) {
    return null;
  }

  for (let cursor = positions.length - 2; cursor >= 0; cursor--) {
    const tighter = (positions[cursor + 1] ?? 0) - 1;
    if (tighter > (positions[cursor] ?? 0) && folded[tighter] === term[cursor]) {
      positions[cursor] = tighter;
    }
  }

  const first = positions[0] ?? 0;
  let score = SUBSEQUENCE_BASE + startBonus(characters, first) - Math.min(first, LATE_START_LIMIT);

  for (let cursor = 1; cursor < positions.length; cursor++) {
    const position = positions[cursor] ?? 0;
    const gap = position - (positions[cursor - 1] ?? 0) - 1;

    if (gap === 0) {
      score += RUN_BONUS;
      continue;
    }

    score -= Math.min(gap, GAP_PENALTY_LIMIT) * GAP_PENALTY;
    if (startsWord(characters, position)) {
      score += RUN_BONUS;
    }
  }

  // A match found is a match worth showing, however badly it scored: the
  // alternative is a row that silently vanishes from a search it satisfies.
  return { score: Math.max(1, score), spans: toSpans(positions) };
};

/**
 * Flattens the spans of several terms into one set of ranges to highlight.
 *
 * Terms are matched one at a time and nothing stops two of them landing on the
 * same characters, so a row highlighted straight from the concatenated spans
 * would open a colour it never closes.
 */
export const mergeSpans = (spans: MatchSpan[]): MatchSpan[] => {
  const merged: MatchSpan[] = [];

  for (const span of spans.toSorted((left, right) => left.start - right.start)) {
    const open = merged.at(-1);
    if (open !== undefined && span.start <= open.end) {
      open.end = Math.max(open.end, span.end);
      continue;
    }

    merged.push({ ...span });
  }

  return merged;
};

/**
 * Splits what was typed into the terms to match and how to case them.
 *
 * Kept apart from the matching so the whole-query decisions — how many terms,
 * whether case counts — are made once per keystroke rather than once per field
 * of every conversation on the board.
 *
 * Case counts only for a query that mixes both, which is narrower than the usual
 * "any capital" rule and deliberately so: `API` and `TODO` are how people write
 * those words, not a request to rule out the rows that spell them differently.
 * `Api` is that request, and it is a thing nobody types by accident.
 */
export const parseQuery = (filter: string): Query => {
  const characters = Array.from(filter);

  return {
    terms: filter.split(/\s+/).filter((term) => term !== ""),
    caseSensitive:
      characters.some(isUpperCase) && characters.some((character) => isLowerCase(character)),
  };
};

/**
 * How well one term matches one piece of text, and where.
 *
 * A one-piece hit always beats a scattered one of the same term, and within each the bonuses
 * favour matches that start a word and characters that stayed together — which
 * between them are most of what makes one result feel more relevant than
 * another. Returns null when the characters are not in there in order at all.
 */
export const scoreMatch = (
  haystack: string,
  term: string,
  caseSensitive = false,
): MatchResult | null => {
  const needle = Array.from(term);
  if (needle.length === 0) {
    return { score: 0, spans: [] };
  }

  const characters = Array.from(haystack);
  if (characters.length < needle.length) {
    return null;
  }

  const fold = (input: string[]): string[] => (caseSensitive ? input : input.map(foldChar));
  const folded = fold(characters);
  const wanted = fold(needle);

  return scoreSubstring(characters, folded, wanted) ?? scoreSubsequence(characters, folded, wanted);
};

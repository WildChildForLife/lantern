/**
 * Conversations one topic-classification pass will ask about, at most.
 *
 * A pass shells out to an agent CLI, so this is the difference between "a
 * minute" and "the afternoon" — and between a small bill and a surprising one.
 *
 * Shared rather than server-side: the selection bar has to warn about a
 * selection that exceeds it *before* the user clicks, which means the number has
 * to be the same on both sides of the wire.
 */
export const MAX_CLASSIFY_PER_PASS = 240;

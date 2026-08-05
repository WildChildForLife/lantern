/**
 * Identity for conversation entries translated from a source that does not
 * supply one.
 *
 * The Claude Code schema requires a uuid on every entry and threads messages by
 * `parentUuid`, so a foreign transcript needs both synthesised. They must be
 * *deterministic*: the search index and every "jump to message" link are keyed
 * by session and position, so a re-sync that produced new ids would break links
 * that already exist.
 *
 * Hashing is done here rather than with node:crypto so the same function can run
 * wherever an entry is built, and because a cryptographic digest buys nothing —
 * these ids only have to be stable and collision-free within one session.
 */

export const FNV_OFFSET_BASIS = 0x811c9dc5;
const PRIME = 0x01000193;

/** FNV-1a, seeded, returned as 8 hex characters. */
export const hash32 = (input: string, seed: number): string => {
  let value = seed;

  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, PRIME) >>> 0;
  }

  return value.toString(16).padStart(8, "0");
};

/**
 * A stable RFC-4122-shaped id for the entry at `index` of a session.
 *
 * Version 5 and the standard variant bits are set so the result validates as a
 * uuid, which the entry schema requires; it is not a real name-based uuid and
 * does not claim to be.
 */
export const syntheticEntryUuid = (sourceId: string, sessionKey: string, index: number): string => {
  const seed = `${sourceId}:${sessionKey}:${index}`;

  const a = hash32(seed, FNV_OFFSET_BASIS);
  const b = hash32(seed, 0x9e3779b9);
  const c = hash32(seed, 0x85ebca6b);
  const d = hash32(seed, 0xc2b2ae35);

  const timeLow = a;
  const timeMid = b.slice(0, 4);
  // Version 5. A uuid has 32 hex digits and the version nibble occupies one of
  // them, so exactly one character of `b` has to give way; this takes the last.
  const timeHigh = `5${b.slice(4, 7)}`;
  // Variant 10xx.
  const clockSeq = `${((Number.parseInt(c.slice(0, 1), 16) & 0x3) | 0x8).toString(16)}${c.slice(1, 4)}`;
  const node = `${c.slice(4, 8)}${d}`;

  return `${timeLow}-${timeMid}-${timeHigh}-${clockSeq}-${node}`;
};

/**
 * Chains entries so each one points at the one before it.
 *
 * Sources that record a flat list of messages have no parent links of their
 * own; the viewer needs them to render a conversation rather than a pile.
 */
export const linkParents = <T extends { readonly uuid: string }>(
  entries: readonly T[],
): Array<T & { parentUuid: string | null }> =>
  entries.map((entry, index) => ({
    ...entry,
    parentUuid: index === 0 ? null : (entries[index - 1]?.uuid ?? null),
  }));

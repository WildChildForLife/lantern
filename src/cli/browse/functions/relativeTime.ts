const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const YEAR = 365 * DAY;

/** Shown when a timestamp cannot be read at all. */
const UNKNOWN = "—";

/**
 * Age of a conversation in the two or three characters a column can spare.
 *
 * `now` is passed in rather than read from the clock so the boundaries are
 * testable and the whole board renders against one instant.
 */
export const formatRelativeTime = (timestamp: string, now: Date): string => {
  const at = new Date(timestamp).getTime();
  if (Number.isNaN(at)) {
    return UNKNOWN;
  }

  // Logs from another machine can be a few seconds ahead; that is not "-3m".
  const elapsed = Math.max(0, now.getTime() - at);

  if (elapsed < MINUTE) return "now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d`;
  if (elapsed < YEAR) return `${Math.floor(elapsed / WEEK)}w`;

  return `${Math.floor(elapsed / YEAR)}y`;
};

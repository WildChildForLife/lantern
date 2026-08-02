/**
 * A stable colour per topic, so a category is recognisable at a glance and
 * keeps the same colour between visits. The classes are written out in full
 * because Tailwind only keeps class names it can see in the source.
 */
const PALETTE = [
  "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300",
  "bg-orange-500/15 text-orange-600 dark:text-orange-300",
  "bg-teal-500/15 text-teal-600 dark:text-teal-300",
  "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300",
  "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300",
  "bg-lime-500/15 text-lime-600 dark:text-lime-300",
  "bg-pink-500/15 text-pink-600 dark:text-pink-300",
] as const;

const NEUTRAL = "bg-muted text-muted-foreground";

/** The catch-all group stays grey: it is the absence of a topic. */
const UNCATEGORIZED_TOPIC_ID = "other";

const hash = (value: string): number => {
  let result = 0;
  for (let index = 0; index < value.length; index++) {
    result = (result * 31 + value.charCodeAt(index)) >>> 0;
  }
  return result;
};

/** Background + foreground classes for a topic's icon chip. */
export const topicColorClass = (topicId: string): string => {
  if (topicId === UNCATEGORIZED_TOPIC_ID) return NEUTRAL;
  return PALETTE[hash(topicId) % PALETTE.length] ?? NEUTRAL;
};

/** Just the foreground colour, for icons shown without a chip behind them. */
export const topicTextColorClass = (topicId: string): string => {
  const classes = topicColorClass(topicId).split(" ");
  return classes.filter((className) => !className.startsWith("bg-")).join(" ");
};

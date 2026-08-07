import { TOPIC_ICON_NAMES } from "../../server/core/session/functions/groupConversationsByTopic.ts";

/**
 * Colours a topic column can take.
 *
 * Named rather than 256-colour or hex so the board still reads on a terminal
 * with a restricted palette, and so it honours whatever theme the user has set
 * instead of fighting it.
 */
export const TOPIC_COLORS = [
  "cyan",
  "magenta",
  "green",
  "yellow",
  "blue",
  "red",
  "cyanBright",
  "magentaBright",
] as const;

export type TopicColor = (typeof TOPIC_COLORS)[number];

export const theme = {
  accent: "yellow",
  muted: "gray",
  danger: "red",
  ok: "green",
} as const;

/**
 * The same topic gets the same colour on every run.
 *
 * Derived from the id rather than the position so the colour does not change
 * when a column moves, which is what makes it useful for finding a column
 * again after a refresh.
 */
export const topicColor = (topicId: string): TopicColor => {
  let hash = 0;
  for (const character of topicId) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 0xffffffff;
  }

  return TOPIC_COLORS[hash % TOPIC_COLORS.length] ?? "cyan";
};

/**
 * Terminal stand-ins for the lucide icons the web app draws.
 *
 * Deliberately plain Unicode rather than Nerd Font glyphs: a missing Nerd Font
 * renders as a replacement box, and a board of boxes is worse than a board of
 * bullets.
 */
const GLYPH_BY_ICON: Record<string, string> = {
  archive: "▤",
  atom: "◎",
  banknote: "¤",
  bot: "☗",
  boxes: "▦",
  brain: "◍",
  briefcase: "▮",
  bug: "✱",
  "calendar-clock": "◷",
  captions: "▭",
  compass: "✧",
  container: "▣",
  cpu: "▩",
  database: "▤",
  download: "↓",
  "file-text": "▤",
  film: "▶",
  "flask-conical": "△",
  "gamepad-2": "◘",
  gauge: "◔",
  "git-branch": "⑂",
  globe: "◍",
  hammer: "⚒",
  "hard-drive": "▬",
  image: "▨",
  layers: "≡",
  "layout-dashboard": "▥",
  mail: "✉",
  monitor: "▭",
  music: "♪",
  package: "▪",
  palette: "◈",
  play: "▶",
  plug: "⌁",
  puzzle: "✦",
  "scroll-text": "▤",
  search: "⌕",
  server: "▮",
  shapes: "◆",
  shield: "⛊",
  smartphone: "▯",
  sparkles: "✶",
  target: "◎",
  terminal: "▸",
  tv: "▭",
  wifi: "≋",
  workflow: "⇶",
};

/** Shown for an icon name this build does not know. */
export const FALLBACK_GLYPH = "•";

export const topicGlyph = (icon: string): string => GLYPH_BY_ICON[icon] ?? FALLBACK_GLYPH;

/** Every icon the grouping code can produce, for the test that keeps these in step. */
export const KNOWN_TOPIC_ICONS = TOPIC_ICON_NAMES;

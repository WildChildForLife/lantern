import type { ConversationListItem } from "../../types.ts";
import { firstUserMessageText } from "./buildConversationListItem.ts";

/**
 * Groups conversations by what they are *about* instead of which folder they
 * were started in, because a single folder (`~`, for instance) collects dozens
 * of unrelated conversations.
 *
 * The clustering is local and deterministic: no model call, no network, no
 * token cost. It reads the title Claude already wrote for each conversation
 * (falling back to the first user message), keeps the meaningful words, and
 * repeatedly carves off the largest group of conversations sharing a word.
 */

export type TopicRef = {
  id: string;
  label: string;
  icon: string;
};

export type TopicGroup = TopicRef & {
  count: number;
};

export type TopicAssignment = {
  topics: TopicGroup[];
  topicBySessionId: Record<string, TopicRef>;
};

/** A word has to be shared by this many conversations before it becomes a topic. */
const MIN_GROUP_SIZE = 2;

/** A word held by more than this share of all conversations is too generic to name a topic. */
const MAX_TOPIC_SHARE = 0.5;

/** ...but a topic may always hold this many conversations, however small the list is. */
const MIN_TOPIC_CEILING = 3;

/** A second word is added to the label when this share of the group also has it. */
const SECONDARY_LABEL_SHARE = 0.6;

const MIN_TOKEN_LENGTH = 3;
const MAX_TOKEN_LENGTH = 24;

/** Conversations that fell out of every group. */
export const UNCATEGORIZED_TOPIC: TopicRef = {
  id: "other",
  label: "Uncategorized",
  icon: "package",
};

/**
 * Words that say nothing about the subject of a conversation: English glue,
 * the verbs every Claude Code title starts with, and the path segments every
 * project lives under.
 */
const STOP_WORDS = new Set([
  // English glue
  "about",
  "after",
  "again",
  "all",
  "already",
  "also",
  "and",
  "any",
  "are",
  "back",
  "because",
  "been",
  "before",
  "being",
  "between",
  "both",
  "but",
  "can",
  "cannot",
  "could",
  "did",
  "does",
  "doing",
  "done",
  "down",
  "each",
  "even",
  "every",
  "for",
  "from",
  "get",
  "gets",
  "getting",
  "had",
  "has",
  "have",
  "her",
  "here",
  "him",
  "his",
  "how",
  "into",
  "its",
  "just",
  "like",
  "made",
  "many",
  "may",
  "might",
  "more",
  "most",
  "much",
  "must",
  "need",
  "needs",
  "not",
  "now",
  "off",
  "one",
  "only",
  "onto",
  "other",
  "our",
  "out",
  "over",
  "own",
  "per",
  "same",
  "she",
  "should",
  "since",
  "some",
  "still",
  "such",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "too",
  "two",
  "under",
  "until",
  "upon",
  "use",
  "used",
  "using",
  "very",
  "via",
  "was",
  "way",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "why",
  "will",
  "with",
  "within",
  "without",
  "would",
  "you",
  "your",
  // Verbs and nouns shared by nearly every conversation title
  "add",
  "app",
  "application",
  "apps",
  "added",
  "adding",
  "adjust",
  "allow",
  "analyze",
  "apply",
  "attempt",
  "avoid",
  "build",
  "building",
  "change",
  "changes",
  "check",
  "checking",
  "clean",
  "cleanup",
  "code",
  "codebase",
  "complete",
  "config",
  "configuration",
  "configure",
  "continue",
  "create",
  "created",
  "critical",
  "creating",
  "current",
  "debug",
  "detect",
  "diagnose",
  "diagnosis",
  "disable",
  "display",
  "enable",
  "ensure",
  "error",
  "errors",
  "explore",
  "extract",
  "fail",
  "failed",
  "failing",
  "failure",
  "feature",
  "file",
  "files",
  "find",
  "finish",
  "fix",
  "fixed",
  "fixes",
  "fixing",
  "folder",
  "handle",
  "identify",
  "implement",
  "implementation",
  "improve",
  "info",
  "information",
  "investigate",
  "issue",
  "issues",
  "keep",
  "knowledge",
  "latest",
  "list",
  "listing",
  "load",
  "locate",
  "major",
  "make",
  "manage",
  "minor",
  "missing",
  "move",
  "new",
  "note",
  "notes",
  "open",
  "option",
  "options",
  "output",
  "page",
  "prepare",
  "prevent",
  "problem",
  "problems",
  "provide",
  "pull",
  "push",
  "read",
  "rebuild",
  "refactor",
  "remove",
  "rename",
  "replace",
  "report",
  "research",
  "reset",
  "resolve",
  "restore",
  "result",
  "results",
  "review",
  "run",
  "running",
  "save",
  "section",
  "set",
  "setting",
  "settings",
  "setup",
  "show",
  "solve",
  "start",
  "state",
  "status",
  "stop",
  "support",
  "switch",
  "sync",
  "task",
  "tasks",
  "tool",
  "tools",
  "troubleshoot",
  "understand",
  "update",
  "updated",
  "upgrade",
  "value",
  "verify",
  "version",
  "view",
  "work",
  "working",
  "write",
  // Path segments that are containers, not subjects
  "claude",
  "code",
  "desktop",
  "dev",
  "documents",
  "home",
  "mnt",
  "project",
  "projects",
  "repo",
  "repos",
  "repositories",
  "root",
  "src",
  "srv",
  "tmp",
  "user",
  "users",
  "var",
  "win",
  "workspace",
]);

/** Words that get a matching icon; anything else falls back to a stable generic one. */
const ICON_BY_KEYWORD: Record<string, string> = {
  agent: "bot",
  agents: "bot",
  ai: "bot",
  android: "smartphone",
  api: "plug",
  audio: "music",
  auth: "shield",
  backup: "archive",
  browser: "globe",
  bug: "bug",
  build: "hammer",
  cache: "database",
  calendar: "calendar-clock",
  cert: "shield",
  chrome: "globe",
  cli: "terminal",
  container: "container",
  cron: "calendar-clock",
  css: "palette",
  cv: "file-text",
  dashboard: "layout-dashboard",
  database: "database",
  design: "palette",
  disk: "hard-drive",
  dns: "wifi",
  docker: "container",
  docs: "file-text",
  download: "download",
  drive: "hard-drive",
  email: "mail",
  firewall: "shield",
  game: "gamepad-2",
  git: "git-branch",
  github: "git-branch",
  gmail: "mail",
  html: "palette",
  http: "globe",
  icon: "palette",
  ios: "smartphone",
  iptv: "tv",
  jellyfin: "film",
  layout: "palette",
  linux: "terminal",
  logs: "scroll-text",
  mac: "monitor",
  mail: "mail",
  markdown: "file-text",
  mcp: "bot",
  media: "film",
  memory: "brain",
  mobile: "smartphone",
  money: "banknote",
  mount: "hard-drive",
  movie: "film",
  movies: "film",
  music: "music",
  network: "wifi",
  nginx: "globe",
  node: "terminal",
  npm: "package",
  password: "shield",
  payment: "banknote",
  performance: "gauge",
  permission: "shield",
  photo: "image",
  pi: "cpu",
  player: "play",
  plugin: "puzzle",
  port: "plug",
  portfolio: "briefcase",
  proxy: "wifi",
  python: "terminal",
  raspberry: "cpu",
  react: "atom",
  router: "wifi",
  samsung: "tv",
  scan: "search",
  screen: "monitor",
  script: "scroll-text",
  security: "shield",
  seo: "search",
  server: "server",
  service: "server",
  shell: "terminal",
  smb: "hard-drive",
  ssh: "terminal",
  ssl: "shield",
  storage: "hard-drive",
  stream: "play",
  subtitle: "captions",
  tailscale: "wifi",
  terminal: "terminal",
  test: "flask-conical",
  tests: "flask-conical",
  tizen: "tv",
  torrent: "download",
  torrents: "download",
  typescript: "terminal",
  ubuntu: "terminal",
  ui: "palette",
  video: "film",
  vpn: "wifi",
  web: "globe",
  website: "globe",
  wifi: "wifi",
  windows: "monitor",
  wordpress: "search",
  wsl: "monitor",
};

const FALLBACK_ICONS = [
  "boxes",
  "compass",
  "layers",
  "puzzle",
  "sparkles",
  "shapes",
  "target",
  "workflow",
];

/** Every icon a topic may carry; the web app maps these names to components. */
export const TOPIC_ICON_NAMES: readonly string[] = [
  ...new Set([...Object.values(ICON_BY_KEYWORD), ...FALLBACK_ICONS, UNCATEGORIZED_TOPIC.icon]),
].sort();

/** Keeps an icon chosen by the classifier inside the set the web app knows. */
export const normalizeTopicIcon = (icon: string): string =>
  TOPIC_ICON_NAMES.includes(icon) ? icon : "boxes";

/** Stable id for a topic that came from a label rather than from a keyword. */
export const topicIdFromLabel = (label: string): string => {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "topic" : slug;
};

/** Words whose conventional casing is not "first letter up". */
const LABEL_CASING: Record<string, string> = {
  api: "API",
  cli: "CLI",
  css: "CSS",
  cv: "CV",
  dns: "DNS",
  html: "HTML",
  http: "HTTP",
  ios: "iOS",
  iptv: "IPTV",
  jdk: "JDK",
  json: "JSON",
  mcp: "MCP",
  npm: "npm",
  pdf: "PDF",
  pi: "Pi",
  seo: "SEO",
  smb: "SMB",
  sql: "SQL",
  ssh: "SSH",
  ssl: "SSL",
  svg: "SVG",
  ui: "UI",
  url: "URL",
  vpn: "VPN",
  wifi: "WiFi",
  wsl: "WSL",
};

const capitalize = (token: string): string =>
  LABEL_CASING[token] ?? `${token.charAt(0).toUpperCase()}${token.slice(1)}`;

const isMeaningfulToken = (token: string): boolean => {
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) return false;
  if (STOP_WORDS.has(token)) return false;
  // Pure numbers, version strings and hashes carry no topic.
  return /[a-z]/.test(token) && !/^\d/.test(token);
};

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(isMeaningfulToken);

/** Directories whose child is a person, not an application. */
const HOME_PARENTS = new Set(["home", "users", "user"]);

const projectFolderName = (path: string): string => {
  const segments = path.split(/[/\\]+/).filter((segment) => segment !== "");
  const name = segments[segments.length - 1] ?? "";
  const parent = segments[segments.length - 2]?.toLowerCase() ?? "";

  // `/mnt/c/Users/<name>` is a home directory: the folder is named after the
  // person, so it says nothing about what the conversation was about.
  return HOME_PARENTS.has(parent) ? "" : name;
};

/**
 * What the conversation is about: the title Claude wrote for it, or the first
 * thing the user typed when there is no title yet.
 */
export const conversationSubjectTokens = (item: ConversationListItem): ReadonlySet<string> => {
  const title = item.title ?? "";
  const text = title === "" ? firstUserMessageText(item).slice(0, 200) : title;

  return new Set(tokenize(text));
};

/**
 * The application the conversation lived in, taken from the last segment of the
 * project path. Only used as a fallback: a folder is a weaker signal than a
 * title, and one folder often collects unrelated conversations.
 */
export const conversationFolderTokens = (item: ConversationListItem): ReadonlySet<string> =>
  new Set(tokenize(projectFolderName(item.projectPath ?? item.projectName ?? "")));

const countTokens = (docs: readonly { tokens: ReadonlySet<string> }[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const doc of docs) {
    for (const token of doc.tokens) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return counts;
};

/** Highest count wins; ties break alphabetically so the output never flickers. */
const pickBestToken = (
  counts: Map<string, number>,
  allowed: ReadonlySet<string>,
): { token: string; count: number } | null => {
  let best: { token: string; count: number } | null = null;
  for (const [token, count] of counts) {
    if (!allowed.has(token)) continue;
    if (best === null || count > best.count || (count === best.count && token < best.token)) {
      best = { token, count };
    }
  }
  return best;
};

const buildLabel = (
  primary: string,
  members: readonly { tokens: ReadonlySet<string> }[],
  allowed: ReadonlySet<string>,
): string => {
  const counts = countTokens(members);
  counts.delete(primary);

  const secondary = pickBestToken(counts, allowed);
  const threshold = Math.ceil(members.length * SECONDARY_LABEL_SHARE);

  if (secondary === null || secondary.count < Math.max(MIN_GROUP_SIZE, threshold)) {
    return capitalize(primary);
  }

  return `${capitalize(primary)} · ${capitalize(secondary.token)}`;
};

const iconFor = (token: string, groupIndex: number): string =>
  ICON_BY_KEYWORD[token] ?? FALLBACK_ICONS[groupIndex % FALLBACK_ICONS.length] ?? "boxes";

type TopicDocument = {
  sessionId: string;
  tokens: ReadonlySet<string>;
};

/**
 * Carves groups out greedily: the word shared by the most still-unassigned
 * conversations becomes a topic, those conversations leave the pool, repeat.
 * That keeps groups disjoint and stops a broad word from swallowing a narrow
 * one.
 */
const carveTopics = (
  docs: readonly TopicDocument[],
  candidates: Set<string>,
  iconOffset: number,
): {
  topics: TopicGroup[];
  topicBySessionId: Record<string, TopicRef>;
  remaining: TopicDocument[];
} => {
  const topics: TopicGroup[] = [];
  const topicBySessionId: Record<string, TopicRef> = {};

  let remaining = [...docs];

  while (remaining.length > 0) {
    const best = pickBestToken(countTokens(remaining), candidates);
    if (best === null || best.count < MIN_GROUP_SIZE) break;

    const members = remaining.filter((doc) => doc.tokens.has(best.token));
    const topic: TopicRef = {
      id: best.token,
      label: buildLabel(best.token, members, candidates),
      icon: iconFor(best.token, iconOffset + topics.length),
    };

    topics.push({ ...topic, count: members.length });
    for (const member of members) {
      topicBySessionId[member.sessionId] = topic;
    }

    candidates.delete(best.token);
    remaining = remaining.filter((doc) => !doc.tokens.has(best.token));
  }

  return { topics, topicBySessionId, remaining };
};

/**
 * Assigns every conversation to exactly one topic.
 *
 * Subjects first: conversations are clustered on the words in their titles.
 * Whatever is left over is then clustered on the folder it was started in, so
 * an app with unremarkable titles still gets its own group. The rest lands in
 * "Uncategorized".
 */
export const groupConversationsByTopic = (
  items: readonly ConversationListItem[],
): TopicAssignment => {
  const frequencyCeiling = Math.max(MIN_TOPIC_CEILING, Math.floor(items.length * MAX_TOPIC_SHARE));

  const candidatesOf = (docs: readonly TopicDocument[], taken: ReadonlySet<string>): Set<string> =>
    new Set(
      [...countTokens(docs).entries()]
        .filter(
          ([token, count]) =>
            count >= MIN_GROUP_SIZE && count <= frequencyCeiling && !taken.has(token),
        )
        .map(([token]) => token),
    );

  const subjectDocs = items.map((item) => ({
    sessionId: item.sessionId,
    tokens: conversationSubjectTokens(item),
  }));

  const bySubject = carveTopics(subjectDocs, candidatesOf(subjectDocs, new Set()), 0);

  const folderTokens = new Map(
    items.map((item) => [item.sessionId, conversationFolderTokens(item)]),
  );
  const folderDocs = bySubject.remaining.map((doc) => ({
    sessionId: doc.sessionId,
    tokens: folderTokens.get(doc.sessionId) ?? new Set<string>(),
  }));
  const takenIds = new Set(bySubject.topics.map((topic) => topic.id));

  const byFolder = carveTopics(
    folderDocs,
    candidatesOf(folderDocs, takenIds),
    bySubject.topics.length,
  );

  const topics = [...bySubject.topics, ...byFolder.topics];
  const topicBySessionId = { ...bySubject.topicBySessionId, ...byFolder.topicBySessionId };

  // Last chance: a leftover that names an existing topic joins it. Groups are
  // carved greedily, so a conversation can mention a topic and still fall
  // through - "portfolio-migrate-vite-docker" belongs under Portfolio even
  // though "portfolio" was never frequent enough in titles to win a round.
  const orphans: TopicDocument[] = [];

  for (const doc of byFolder.remaining) {
    const tokens = new Set([
      ...doc.tokens,
      ...(subjectDocs.find((subject) => subject.sessionId === doc.sessionId)?.tokens ?? []),
    ]);

    const adopting = topics
      .filter((topic) => tokens.has(topic.id))
      .sort((left, right) => right.count - left.count)[0];

    if (adopting === undefined) {
      orphans.push(doc);
      continue;
    }

    adopting.count += 1;
    topicBySessionId[doc.sessionId] = {
      id: adopting.id,
      label: adopting.label,
      icon: adopting.icon,
    };
  }

  topics.sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  if (orphans.length > 0) {
    topics.push({ ...UNCATEGORIZED_TOPIC, count: orphans.length });
    for (const doc of orphans) {
      topicBySessionId[doc.sessionId] = UNCATEGORIZED_TOPIC;
    }
  }

  return { topics, topicBySessionId };
};

/**
 * Groups conversations using the topics Claude assigned, and falls back to the
 * local keyword clustering for anything not classified yet. Both kinds of topic
 * live in one list, so the dashboard looks the same whether a conversation was
 * classified a second ago or never.
 */
export const groupConversationsWithAssignedTopics = (
  items: readonly ConversationListItem[],
  assigned: Readonly<Record<string, TopicRef>>,
): TopicAssignment => {
  const topicBySessionId: Record<string, TopicRef> = {};
  const groupById = new Map<string, TopicGroup>();
  const unassigned: ConversationListItem[] = [];

  for (const item of items) {
    const topic = assigned[item.sessionId];
    if (topic === undefined) {
      unassigned.push(item);
      continue;
    }

    topicBySessionId[item.sessionId] = topic;
    const group = groupById.get(topic.id);
    if (group === undefined) {
      groupById.set(topic.id, { ...topic, count: 1 });
    } else {
      group.count += 1;
    }
  }

  const fallback = groupConversationsByTopic(unassigned);

  for (const [sessionId, topic] of Object.entries(fallback.topicBySessionId)) {
    topicBySessionId[sessionId] = topic;
  }

  for (const group of fallback.topics) {
    const existing = groupById.get(group.id);
    if (existing === undefined) {
      groupById.set(group.id, { ...group });
    } else {
      existing.count += group.count;
    }
  }

  const topics = [...groupById.values()].sort((left, right) => {
    // The catch-all belongs at the end whatever its size.
    if (left.id === UNCATEGORIZED_TOPIC.id) return 1;
    if (right.id === UNCATEGORIZED_TOPIC.id) return -1;
    return right.count - left.count || left.label.localeCompare(right.label);
  });

  return { topics, topicBySessionId };
};

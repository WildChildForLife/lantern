import { expect, test } from "vitest";
import type { ConversationListItem } from "../../types.ts";
import {
  conversationFolderTokens,
  conversationSubjectTokens,
  groupConversationsByTopic,
  groupConversationsWithAssignedTopics,
} from "./groupConversationsByTopic.ts";

const conversation = (
  sessionId: string,
  title: string | null,
  projectPath = "/root",
): ConversationListItem => ({
  sessionId,
  projectId: "project",
  source: "claude-code",
  projectName: null,
  projectPath,
  title,
  firstUserMessage: null,
  messageCount: 1,
  lastModifiedAt: "2026-01-01T00:00:00.000Z",
  modelName: null,
  totalCostUsd: 0,
  costConfidence: "estimated",
});

test("keeps subject words and drops glue and verbs", () => {
  const tokens = conversationSubjectTokens(
    conversation("a", "Fix the Tizen IPTV subtitle error", "/root/Repositories/tizen-iptv"),
  );

  expect([...tokens].sort()).toEqual(["iptv", "subtitle", "tizen"]);
});

test("reads the application name from the project folder", () => {
  const tokens = conversationFolderTokens(
    conversation("a", "Anything", "/root/Repositories/tizen-iptv"),
  );

  expect([...tokens].sort()).toEqual(["iptv", "tizen"]);
});

test("ignores a home directory, which is named after a person not an app", () => {
  expect([...conversationFolderTokens(conversation("a", "Anything", "/mnt/c/Users/alex"))]).toEqual(
    [],
  );
});

test("groups leftover conversations by their project folder", () => {
  const { topics } = groupConversationsByTopic([
    conversation("1", "Nothing in common here", "/home/me/netcmd"),
    conversation("2", "Totally different words", "/home/me/netcmd"),
  ]);

  expect(topics).toEqual([{ id: "netcmd", label: "Netcmd", icon: "boxes", count: 2 }]);
});

test("falls back to the first user message when there is no title", () => {
  const item: ConversationListItem = {
    ...conversation("a", null),
    firstUserMessage: { kind: "text", content: "the wordpress sitemap disappeared" },
  };

  expect([...conversationSubjectTokens(item)].sort()).toEqual([
    "disappeared",
    "sitemap",
    "wordpress",
  ]);
});

test("groups conversations sharing a subject word and counts them", () => {
  const { topics, topicBySessionId } = groupConversationsByTopic([
    conversation("1", "Deploy the Tizen app"),
    conversation("2", "Tizen focus border clipping"),
    conversation("3", "Tizen player crashes"),
    conversation("4", "Mount the SMB share"),
    conversation("5", "SMB password refused"),
  ]);

  expect(topics).toEqual([
    { id: "tizen", label: "Tizen", icon: "tv", count: 3 },
    { id: "smb", label: "SMB", icon: "hard-drive", count: 2 },
  ]);
  expect(topicBySessionId["1"]?.id).toBe("tizen");
  expect(topicBySessionId["4"]?.id).toBe("smb");
});

test("puts conversations with no shared subject into a single Uncategorized topic", () => {
  const { topics, topicBySessionId } = groupConversationsByTopic([
    conversation("1", "Docker daemon refuses to boot"),
    conversation("2", "Docker compose port clash"),
    conversation("3", "Something entirely unrelated"),
  ]);

  expect(topics.map((topic) => [topic.id, topic.count])).toEqual([
    ["docker", 2],
    ["other", 1],
  ]);
  expect(topicBySessionId["3"]).toEqual({
    id: "other",
    label: "Uncategorized",
    icon: "package",
  });
});

test("assigns every conversation to exactly one topic", () => {
  const items = [
    conversation("1", "Tizen IPTV player"),
    conversation("2", "Tizen IPTV subtitles"),
    conversation("3", "IPTV channel list"),
    conversation("4", "Wifi router dropping"),
    conversation("5", "Wifi router firmware"),
  ];

  const { topics, topicBySessionId } = groupConversationsByTopic(items);

  expect(Object.keys(topicBySessionId).sort()).toEqual(["1", "2", "3", "4", "5"]);
  expect(topics.reduce((total, topic) => total + topic.count, 0)).toBe(items.length);
});

test("adds a second word to the label when the whole group shares it", () => {
  const { topics } = groupConversationsByTopic([
    conversation("1", "Wordpress SEO ranking dropped"),
    conversation("2", "Wordpress SEO sitemap"),
    conversation("5", "Wordpress plugin broken"),
    conversation("3", "Docker network"),
    conversation("4", "Docker network"),
  ]);

  expect(topics.find((topic) => topic.id === "wordpress")?.label).toBe("Wordpress · SEO");
});

test("returns no topics for an empty list", () => {
  expect(groupConversationsByTopic([])).toEqual({ topics: [], topicBySessionId: {} });
});

test("a leftover that names an existing topic joins it instead of Uncategorized", () => {
  const { topics, topicBySessionId } = groupConversationsByTopic([
    // These two only share their folder, so Portfolio comes from the folder pass.
    conversation("1", "Make flying man SVG open eyes on hover", "/home/me/portfolio"),
    conversation("2", "Improve CV for employer appeal", "/home/me/portfolio"),
    // Names the portfolio in its title, but was started elsewhere.
    conversation("3", "portfolio-migrate-vite-docker", "/root"),
    conversation("4", "Something else entirely", "/root"),
  ]);

  expect(topicBySessionId["3"]?.id).toBe("portfolio");
  expect(topics.find((topic) => topic.id === "portfolio")?.count).toBe(3);
  expect(topics.find((topic) => topic.id === "other")?.count).toBe(1);
});

test("uses assigned topics and keyword clustering side by side", () => {
  const items = [
    conversation("1", "Deploy the TV app"),
    conversation("2", "Fix the subtitle timing"),
    conversation("3", "Docker compose port clash"),
    conversation("4", "Docker daemon refuses to boot"),
    conversation("5", "Nothing in common at all"),
  ];

  const { topics, topicBySessionId } = groupConversationsWithAssignedTopics(items, {
    "1": { id: "tizen-iptv", label: "Tizen IPTV", icon: "tv" },
    "2": { id: "tizen-iptv", label: "Tizen IPTV", icon: "tv" },
  });

  expect(topics).toEqual([
    { id: "docker", label: "Docker", icon: "container", count: 2 },
    { id: "tizen-iptv", label: "Tizen IPTV", icon: "tv", count: 2 },
    { id: "other", label: "Uncategorized", icon: "package", count: 1 },
  ]);
  expect(topicBySessionId["2"]?.label).toBe("Tizen IPTV");
  expect(topicBySessionId["3"]?.id).toBe("docker");
});

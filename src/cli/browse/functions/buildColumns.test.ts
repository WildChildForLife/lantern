import { describe, expect, it } from "vitest";
import type { ConversationListEntry, TopicGroup } from "../../../server/core/types.ts";
import { buildColumns } from "./buildColumns.ts";

const topic = (id: string, label: string, count: number): TopicGroup => ({
  id,
  label,
  icon: "package",
  count,
});

const conversation = (
  overrides: Partial<ConversationListEntry> & { sessionId: string; topicId: string },
): ConversationListEntry => ({
  sessionId: overrides.sessionId,
  projectId: overrides.projectId ?? "project",
  source: overrides.source ?? "claude-code",
  projectName: overrides.projectName ?? "lantern",
  projectPath: overrides.projectPath ?? "/home/dev/lantern",
  title: overrides.title ?? null,
  firstUserMessage: overrides.firstUserMessage ?? null,
  messageCount: overrides.messageCount ?? 3,
  lastModifiedAt: overrides.lastModifiedAt ?? "2026-08-01T00:00:00.000Z",
  modelName: overrides.modelName ?? "sonnet",
  totalCostUsd: overrides.totalCostUsd ?? 0,
  costConfidence: overrides.costConfidence ?? "reported",
  topic: { id: overrides.topicId, label: "", icon: "package" },
});

const topics = [topic("api", "Orders API", 2), topic("net", "Home Network", 1)];

const conversations = [
  conversation({
    sessionId: "a",
    topicId: "api",
    title: "Fix checkout",
    lastModifiedAt: "2026-08-01T00:00:00.000Z",
  }),
  conversation({
    sessionId: "b",
    topicId: "api",
    title: "Add refunds",
    lastModifiedAt: "2026-08-03T00:00:00.000Z",
  }),
  conversation({
    sessionId: "c",
    topicId: "net",
    title: "Router DHCP",
    lastModifiedAt: "2026-08-06T00:00:00.000Z",
  }),
];

describe("buildColumns", () => {
  it("partitions conversations into their own topic", () => {
    const columns = buildColumns({ topics, conversations, filter: "" });

    expect(columns.map((column) => column.topic.id)).toStrictEqual(["net", "api"]);
    expect(columns[1]?.rows.map((row) => row.sessionId)).toStrictEqual(["b", "a"]);
  });

  /** The thing worked on last is the thing being looked for. */
  it("puts the freshest topic first", () => {
    expect(buildColumns({ topics, conversations, filter: "" })[0]?.topic.id).toBe("net");
  });

  it("sorts conversations newest first inside a column", () => {
    const rows = buildColumns({ topics, conversations, filter: "" })[1]?.rows ?? [];

    expect(rows.map((row) => row.sessionId)).toStrictEqual(["b", "a"]);
  });

  it("keeps every row of a topic whose name matches the filter", () => {
    const columns = buildColumns({ topics, conversations, filter: "orders" });

    expect(columns).toHaveLength(1);
    expect(columns[0]?.rows).toHaveLength(2);
  });

  /** Typing a conversation title has to find it, not just a topic name. */
  it("keeps only the matching rows when the filter matches a conversation", () => {
    const columns = buildColumns({ topics, conversations, filter: "refunds" });

    expect(columns).toHaveLength(1);
    expect(columns[0]?.rows.map((row) => row.sessionId)).toStrictEqual(["b"]);
  });

  it("matches on the project a conversation ran in", () => {
    expect(buildColumns({ topics, conversations, filter: "lantern" })).toHaveLength(2);
  });

  it("ignores case", () => {
    expect(buildColumns({ topics, conversations, filter: "ORDERS" })).toHaveLength(1);
  });

  it("drops topics with nothing left to show", () => {
    expect(buildColumns({ topics, conversations, filter: "nothing matches" })).toStrictEqual([]);
  });

  /** A topic the cache knows about but has no rows for would be an empty column. */
  it("drops a topic with no conversations at all", () => {
    const columns = buildColumns({
      topics: [...topics, topic("ghost", "Ghost", 0)],
      conversations,
      filter: "",
    });

    expect(columns.map((column) => column.topic.id)).not.toContain("ghost");
  });

  it("falls back to the first user message when a conversation has no title", () => {
    const columns = buildColumns({
      topics: [topic("api", "Orders API", 1)],
      conversations: [
        conversation({
          sessionId: "a",
          topicId: "api",
          title: null,
          firstUserMessage: { kind: "text", content: "please  fix\nthe checkout flow" },
        }),
      ],
      filter: "checkout",
    });

    expect(columns[0]?.rows[0]?.displayTitle).toBe("please fix the checkout flow");
  });

  it("falls back to the session id when there is nothing to title it with", () => {
    const columns = buildColumns({
      topics: [topic("api", "Orders API", 1)],
      conversations: [conversation({ sessionId: "abc-123", topicId: "api", title: null })],
      filter: "",
    });

    expect(columns[0]?.rows[0]?.displayTitle).toBe("abc-123");
  });
});

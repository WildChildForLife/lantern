import { describe, expect, it } from "vitest";
import type { ConversationListEntry } from "../../../server/core/types.ts";
import type { BoardRow } from "./buildColumns.ts";
import { statusFields } from "./statusFields.ts";

const row = (overrides?: Partial<ConversationListEntry>): BoardRow => ({
  sessionId: "s-refund",
  projectId: "api",
  projectName: "api",
  projectPath: "/home/dev/lantern",
  source: "claude-code",
  title: "Add refunds",
  firstUserMessage: null,
  messageCount: 4,
  lastModifiedAt: "2026-08-06T00:00:00.000Z",
  modelName: "sonnet",
  totalCostUsd: 0.42,
  costConfidence: "estimated",
  topic: { id: "api", label: "API", icon: "plug" },
  displayTitle: "Add refunds",
  titleSpans: [],
  ...overrides,
});

const field = (name: string, from: BoardRow) =>
  statusFields(from).find((candidate) => candidate.name === name);

describe("statusFields", () => {
  it("lists every fact the row cannot spare the width for, in reading order", () => {
    expect(statusFields(row()).map((entry) => entry.name)).toStrictEqual([
      "project",
      "source",
      "model",
      "cost",
      "messages",
      "id",
    ]);
  });

  it("gives each fact its own colour, so none of them look like another", () => {
    const colors = statusFields(row())
      .map((entry) => entry.color)
      .filter((color) => color !== null);

    expect(new Set(colors).size).toBe(colors.length);
  });

  it("prefers the full path to the project name", () => {
    expect(field("project", row())?.text).toBe("/home/dev/lantern");
    expect(field("project", row({ projectPath: null }))?.text).toBe("api");
  });

  it("leaves a fact the logs do not carry uncoloured", () => {
    expect(field("project", row({ projectPath: null, projectName: null }))).toStrictEqual({
      name: "project",
      text: "unknown project",
      color: null,
    });
    expect(field("model", row({ modelName: null }))).toStrictEqual({
      name: "model",
      text: "unknown model",
      color: null,
    });
  });

  it("leaves the session id uncoloured: it is there to be copied, not read", () => {
    expect(field("id", row())).toStrictEqual({ name: "id", text: "s-refund", color: null });
  });

  it("carries the cost with its confidence, never the bare number", () => {
    expect(field("cost", row())?.text).toBe("~$0.42");
    expect(field("cost", row({ costConfidence: "reported" }))?.text).toBe("$0.42");
    expect(field("cost", row({ costConfidence: "unknown" }))?.text).toBe("—");
  });

  it("counts the messages", () => {
    expect(field("messages", row())?.text).toBe("4 messages");
  });
});

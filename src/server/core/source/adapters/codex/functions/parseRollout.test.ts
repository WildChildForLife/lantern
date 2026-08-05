/* Node built-ins are used directly here: the fixture is read as a plain file. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConversationSchema } from "../../../../../../lib/conversation-schema/index.ts";
import { parseRollout } from "./parseRollout.ts";

const fixture = (name: string) =>
  readFileSync(`${process.cwd()}/fixtures/codex-home/${name}`, "utf-8");

const NORMAL =
  "sessions/2026/07/28/rollout-2026-07-28T09-14-02-0199a1c4-9e2f-7bd1-a4c6-1f5b2d8e3a70.jsonl";
const TRUNCATED =
  "sessions/2026/07/28/rollout-2026-07-28T11-02-00-0199a1d0-3c77-7a02-9e11-88b4c6f0d215.jsonl";

describe("parseRollout", () => {
  it("reads the session's own metadata", () => {
    const { meta } = parseRollout(fixture(NORMAL), "session-key");

    expect(meta.sessionId).toBe("0199a1c4-9e2f-7bd1-a4c6-1f5b2d8e3a70");
    expect(meta.cwd).toBe("/home/demo/orders-api");
    expect(meta.cliVersion).toBe("0.141.0");
    expect(meta.model).toBe("gpt-5-codex");
  });

  it("turns a message pair, a tool call and its output into four entries", () => {
    const { entries } = parseRollout(fixture(NORMAL), "session-key");

    expect(entries.map((entry) => entry.type)).toStrictEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  /** Everything downstream — rendering, search, export — validates against this. */
  it("produces entries the conversation schema accepts", () => {
    const { entries } = parseRollout(fixture(NORMAL), "session-key");

    for (const entry of entries) {
      expect(ConversationSchema.safeParse(entry).success).toBe(true);
    }
  });

  it("carries a shell call across as a tool use with parsed arguments", () => {
    const { entries } = parseRollout(fixture(NORMAL), "session-key");
    const toolUse = entries
      .flatMap((entry) => (entry.type === "assistant" ? entry.message.content : []))
      .find((block) => block.type === "tool_use");

    expect(toolUse?.type === "tool_use" && toolUse.name).toBe("shell");
    expect(toolUse?.type === "tool_use" && toolUse.input).toStrictEqual({
      command: ["rg", "-n", "def create_order", "app/"],
    });
  });

  it("pairs the tool result with the call that produced it", () => {
    const { entries } = parseRollout(fixture(NORMAL), "session-key");
    const result = entries
      .flatMap((entry) =>
        entry.type === "user" && Array.isArray(entry.message.content) ? entry.message.content : [],
      )
      .find((block) => typeof block === "object" && block.type === "tool_result");

    expect(result !== undefined && result.type === "tool_result" && result.tool_use_id).toBe(
      "call_9f2c",
    );
  });

  it("threads entries so the viewer can render a conversation", () => {
    const { entries } = parseRollout(fixture(NORMAL), "session-key");
    const first = entries[0];
    const second = entries[1];

    if (first === undefined || second === undefined) {
      throw new Error("expected at least two entries");
    }
    if (!("uuid" in first) || !("parentUuid" in second)) {
      throw new Error("expected threaded entries");
    }

    expect(first.parentUuid).toBeNull();
    expect(second.parentUuid).toBe(first.uuid);
  });

  it("drops the harness's own developer turn", () => {
    const { entries } = parseRollout(fixture(NORMAL), "session-key");
    const texts = entries.flatMap((entry) =>
      entry.type === "user" && typeof entry.message.content === "string"
        ? [entry.message.content]
        : [],
    );

    expect(texts.some((text) => text.includes("You are a coding agent"))).toBe(false);
  });

  /**
   * The count is what makes a wrong format assumption visible instead of
   * rendering a whole history as blank rows.
   */
  it("reports nothing unparsed for a well-formed session", () => {
    const { parseStats } = parseRollout(fixture(NORMAL), "session-key");

    expect(parseStats.unparsed).toBe(0);
    expect(parseStats.ignored).toBeGreaterThan(0);
  });

  it("counts a line type it does not know as ignored, not unparsed", () => {
    const { parseStats } = parseRollout(
      '{"timestamp":"2026-07-28T09:00:00.000Z","type":"something_new","payload":{}}',
      "session-key",
    );

    expect(parseStats).toStrictEqual({ total: 1, ignored: 1, unparsed: 0 });
  });

  /** Lantern reads while the CLI is still writing. */
  it("keeps the complete turns of a session whose last line is half-written", () => {
    const { entries, parseStats } = parseRollout(fixture(TRUNCATED), "session-key");

    expect(entries).toHaveLength(1);
    expect(parseStats.unparsed).toBe(1);
  });

  it("is deterministic, so re-reading does not move any message links", () => {
    const first = parseRollout(fixture(NORMAL), "session-key");
    const second = parseRollout(fixture(NORMAL), "session-key");

    expect(JSON.stringify(first.entries)).toBe(JSON.stringify(second.entries));
  });
});

describe("injected context", () => {
  it("drops the environment block Codex writes as a user turn", () => {
    const parsed = parseRollout(
      fixture(
        "sessions/2026/07/28/rollout-2026-07-28T09-14-02-0199a1c4-9e2f-7bd1-a4c6-1f5b2d8e3a70.jsonl",
      ),
      "0199a1c4-9e2f-7bd1-a4c6-1f5b2d8e3a70",
    );

    const userTexts = parsed.entries.flatMap((entry) =>
      entry.type === "user" && typeof entry.message.content === "string"
        ? [entry.message.content]
        : [],
    );

    // Codex opens every session with the cwd, shell and sandbox policy as a
    // `user` turn. It is the first user message, which is what the conversation
    // list uses as a title — so leaving it in titles every Codex session with a
    // block of XML.
    expect(userTexts.some((text) => text.includes("<environment_context>"))).toBe(false);
    expect(userTexts.at(0)).toBe("The orders endpoint 500s on empty carts");
  });

  it("keeps a message that merely mentions the block", () => {
    const line = JSON.stringify({
      timestamp: "2026-07-28T09:20:00.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "why is <environment_context> injected?" }],
      },
    });

    const parsed = parseRollout(line, "session-key");

    // Only a turn that is entirely the block is scaffolding. Asking about one
    // is conversation.
    expect(parsed.entries).toHaveLength(1);
  });
});

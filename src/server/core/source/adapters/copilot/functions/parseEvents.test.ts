/* Node built-ins are used directly here: the fixture is read as a plain file. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConversationSchema } from "../../../../../../lib/conversation-schema/index.ts";
import { parseEvents, parseMeta } from "./parseEvents.ts";

/**
 * The fixtures are a real Copilot CLI 1.0.78 run, captured from `docker/` and
 * copied verbatim. Nothing here is hand-authored, which is the point: the
 * formats this project got wrong before were wrong because they were described
 * rather than observed.
 */
const fixture = (id: string) =>
  readFileSync(`${process.cwd()}/fixtures/copilot-home/session-state/${id}/events.jsonl`, "utf-8");

/** Two failed tool calls, interleaved with reasoning and a closing reply. */
const TOOLS = "049410b4-c1df-44ee-87a5-caa1c349091e";
/** The only session in the capture where a tool call succeeded. */
const TOOL_SUCCESS = "f27af309-ccf3-41da-8f07-b3dcbffd4c90";
/** A plain question: one reasoning block, one answer, no tools. */
const SIMPLE = "e317ef84-75eb-4afe-a1c6-0bd44c47f978";

const ALL = [TOOLS, TOOL_SUCCESS, SIMPLE, "8b23eac7-b9d0-4c24-8e3c-90f5f8a8d02b"];

const parse = (id: string) => parseEvents(fixture(id), id);

/**
 * Entries are read structurally rather than narrowed by type.
 *
 * `ExtendedConversation` includes an error variant carrying neither `uuid` nor
 * a message, so reaching for either directly is unsound — and casting the union
 * away would defeat the point of a test that checks what was produced.
 */
const blocksOfType = (
  entries: readonly { readonly type: string }[],
  blockType: string,
): Record<string, unknown>[] =>
  entries.flatMap((entry) => {
    if (!("message" in entry) || typeof entry.message !== "object" || entry.message === null) {
      return [];
    }
    if (!("content" in entry.message)) return [];

    const content = entry.message.content;
    if (!Array.isArray(content)) return [];

    return content.flatMap((block: unknown) =>
      typeof block === "object" && block !== null && "type" in block && block.type === blockType
        ? [{ ...block }]
        : [],
    );
  });

const stringField = (holder: object, key: string): string | undefined => {
  if (!(key in holder)) return undefined;
  const value: unknown = Reflect.get(holder, key);
  return typeof value === "string" ? value : undefined;
};

/** The plain-string content of the user turns, which is where prompts land. */
const userTexts = (entries: readonly { readonly type: string }[]): string[] =>
  entries.flatMap((entry) => {
    if (entry.type !== "user") return [];
    if (!("message" in entry) || typeof entry.message !== "object" || entry.message === null) {
      return [];
    }
    if (!("content" in entry.message)) return [];
    return typeof entry.message.content === "string" ? [entry.message.content] : [];
  });

describe("parseEvents", () => {
  it("reads every captured session without a single unparsed line", () => {
    for (const id of ALL) {
      expect(parse(id).parseStats.unparsed).toBe(0);
    }
  });

  it("produces entries the conversation schema accepts", () => {
    for (const entry of parse(TOOLS).entries) {
      expect(ConversationSchema.safeParse(entry).success).toBe(true);
    }
  });

  it("reads the session's identity from its opening event", () => {
    const meta = parse(TOOLS).meta;

    expect(meta.cwd).toBe("/work");
    expect(meta.gitRoot).toBe("/work");
    expect(meta.cliVersion).toBe("1.0.78");
    expect(meta.sessionId).toBe(TOOLS);
  });

  it("takes what the person typed, not the text the CLI wrapped it in", () => {
    // Copilot stores the prompt twice: `content` as typed, and
    // `transformedContent` with a <current_datetime> block and a
    // <system_reminder> injected around it. Rendering the latter would make
    // every session's title start with a timestamp — the same mistake Codex's
    // <environment_context> already taught once.
    const texts = userTexts(parse(TOOLS).entries);

    expect(texts[0]).toBe(
      "In src/orders.py make average_item_price return 0 when the cart has no items.",
    );
    expect(texts.some((text) => text.includes("<current_datetime>"))).toBe(false);
  });

  it("keeps the model's reasoning apart from what it said", () => {
    const entries = parse(SIMPLE).entries;

    // A thought rendered as text would show the user the model's working as
    // though it were the answer.
    expect(blocksOfType(entries, "thinking")).toHaveLength(1);
    expect(blocksOfType(entries, "text")).toHaveLength(1);
  });

  it("pairs each tool call with the result that answered it, in order", () => {
    const entries = parse(TOOLS).entries;

    const calls = blocksOfType(entries, "tool_use");
    const results = blocksOfType(entries, "tool_result");

    // The outcome is a separate event that lands after the call, so this is
    // really a test that the deferred slot was filled with the right result.
    expect(calls).toHaveLength(2);
    expect(results.map((result) => stringField(result, "tool_use_id"))).toStrictEqual(
      calls.map((call) => stringField(call, "id")),
    );
    expect(stringField(calls[0] ?? {}, "name")).toBe("view");
  });

  it("marks a failed tool result as an error, and carries the reason", () => {
    const result = blocksOfType(parse(TOOLS).entries, "tool_result").at(0);

    expect(result?.["is_error"]).toBe(true);
    expect(result && stringField(result, "content")).toContain("Required");
  });

  it("renders a successful tool result as its output rather than an error", () => {
    const results = blocksOfType(parse(TOOL_SUCCESS).entries, "tool_result").filter(
      (result) => result["is_error"] !== true,
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results.at(0)?.["content"]).not.toBe("");
  });

  it("does not render the CLI's own system prompt as a message", () => {
    // `system.message` holds thousands of words of instructions nobody typed.
    // It would otherwise be the first message, and so the session's title.
    const texts = userTexts(parse(SIMPLE).entries);

    expect(texts.every((text) => !text.includes("You are the GitHub Copilot CLI"))).toBe(true);
    expect(parse(SIMPLE).parseStats.ignored).toBeGreaterThan(0);
  });

  it("totals the tokens the session reported when it shut down", () => {
    // The CLI printed "Tokens ↑ 2.0k • ↓ 304" for this session as it exited.
    const usage = parse(SIMPLE).usage;

    expect(usage.inputTokens).toBe(2050);
    expect(usage.outputTokens).toBe(304);
    // Copilot bills in premium requests, and under BYOK the user pays their own
    // provider. Neither is a figure Lantern can turn into a cost.
    expect(usage.costUsd).toBeNull();
    expect(usage.modelName).toBe("qwen3:0.6b");
  });

  it("counts an unreadable line instead of dropping it", () => {
    const parsed = parseEvents('{ not json\n{"type":"nonsense.event","data":{}}', "s");

    // The bad JSON is unreadable; the well-formed event of an unknown type is
    // also unreadable, because a type that is neither rendered nor named is how
    // a format change announces itself.
    expect(parsed.parseStats.unparsed).toBe(2);
    expect(parsed.unparsedLines).toStrictEqual([1, 2]);
  });

  it("ignores a blank trailing line rather than counting it unreadable", () => {
    // Every append leaves one, so treating it as a format surprise would report
    // every healthy session as damaged.
    expect(parseEvents("\n\n", "s").parseStats.unparsed).toBe(0);
  });

  it("gives the same entry ids every time it reads the same session", () => {
    // Search rows and deep links are keyed by these, so a re-sync that renamed
    // them would break links that already exist.
    const uuids = () => parse(TOOLS).entries.map((entry) => stringField(entry, "uuid"));

    expect(uuids()).toStrictEqual(uuids());
    expect(uuids().every((uuid) => uuid !== undefined)).toBe(true);
  });

  it("chains each entry to the one before it", () => {
    const entries = parse(TOOLS).entries;
    const uuids = entries.map((entry) => stringField(entry, "uuid"));
    const parents = entries.map((entry) => stringField(entry, "parentUuid"));

    expect(parents).toStrictEqual([undefined, ...uuids.slice(0, -1)]);
  });

  describe("parseMeta", () => {
    it("finds the same identity a full parse does, from the head alone", () => {
      // Grouping thousands of sessions by workspace reads only this much.
      const head = fixture(TOOLS).slice(0, 8 * 1024);

      expect(parseMeta(head)).toStrictEqual(parse(TOOLS).meta);
    });

    it("reports nothing rather than guessing when the opening event is absent", () => {
      expect(parseMeta('{"type":"user.message","data":{"content":"hi"}}').cwd).toBeNull();
      expect(parseMeta("").sessionId).toBeNull();
    });
  });
});

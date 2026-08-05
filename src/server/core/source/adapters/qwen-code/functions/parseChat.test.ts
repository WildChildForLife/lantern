/* Node built-ins are used directly here: the fixture is read as a plain file. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConversationSchema } from "../../../../../../lib/conversation-schema/index.ts";
import { parseChat } from "./parseChat.ts";

/**
 * The fixtures are a real Qwen Code 0.21.6 run, captured from `docker/` and
 * copied verbatim. Nothing here is hand-authored, which is the point: the two
 * formats this project got wrong before were both wrong because they were
 * described rather than observed.
 */
const fixture = (name: string) =>
  readFileSync(`${process.cwd()}/fixtures/qwen-home/projects/-work/chats/${name}`, "utf-8").split(
    "\n",
  );

/** A plain question and answer: no tools, one thought, one reply. */
const SIMPLE = "a719f84a-209d-406a-8e6c-dc671c9c0192.jsonl";
/** Three tool calls, each answered, interleaved with reasoning. */
const TOOLS = "c190cd9d-544a-49d6-ab6c-f38d501ca4b8.jsonl";
/** The one session where a tool call actually succeeded. */
const TOOL_SUCCESS = "27d495d1-de2d-449d-af11-d42d4d6ef80d.jsonl";

const parse = (name: string) =>
  parseChat(fixture(name), { sessionKey: name.replace(/\.jsonl$/, ""), cwd: "" });

/**
 * Entries are read structurally rather than narrowed by type.
 *
 * `ExtendedConversation` includes an error variant that carries neither `uuid`
 * nor a message, so reaching for either directly is unsound — and casting the
 * union away would defeat the point of a test that checks what was produced.
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

/** One string field of a block or entry, or undefined when it has none. */
const stringField = (holder: object, key: string): string | undefined => {
  if (!(key in holder)) return undefined;
  const value: unknown = Reflect.get(holder, key);
  return typeof value === "string" ? value : undefined;
};

describe("parseChat", () => {
  it("reads every captured session without a single unparsed line", () => {
    for (const name of [SIMPLE, TOOLS, TOOL_SUCCESS]) {
      expect(parse(name).parseStats.unparsed).toBe(0);
    }
  });

  it("produces entries the conversation schema accepts", () => {
    for (const entry of parse(TOOLS).entries) {
      expect(ConversationSchema.safeParse(entry).success).toBe(true);
    }
  });

  it("takes the working directory from the record rather than the directory name", () => {
    // The project directory is `-work`, which cannot be decoded back to `/work`
    // unambiguously. Every record stamps the real path.
    expect(parse(SIMPLE).cwd).toBe("/work");
  });

  it("separates the model's reasoning from what it said", () => {
    const entries = parse(SIMPLE).entries;

    expect(entries.map((entry) => entry.type)).toStrictEqual(["user", "assistant", "assistant"]);

    // A thought rendered as text would show the user the model's working as
    // though it were the answer.
    expect(blocksOfType(entries, "thinking")).toHaveLength(1);
    expect(blocksOfType(entries, "text")).toHaveLength(1);
  });

  it("pairs each tool call with the result that answered it", () => {
    const entries = parse(TOOLS).entries;

    const calls = blocksOfType(entries, "tool_use");
    const results = blocksOfType(entries, "tool_result");

    expect(calls).toHaveLength(3);
    expect(results.map((result) => stringField(result, "tool_use_id"))).toStrictEqual(
      calls.map((call) => stringField(call, "id")),
    );
  });

  it("carries a tool call's name and arguments across", () => {
    const call = blocksOfType(parse(TOOLS).entries, "tool_use").at(0);

    expect(call && stringField(call, "name")).toBe("read_file");
    expect(call?.["input"]).toStrictEqual({ file_path: "src/orders.py" });
  });

  it("marks a failed tool result as an error rather than as output", () => {
    const result = blocksOfType(parse(TOOLS).entries, "tool_result").at(0);

    expect(result?.["is_error"]).toBe(true);
    expect(result && stringField(result, "content")).toContain("File path must be absolute");
  });

  it("renders a successful tool result as its output, not as an error", () => {
    // A failed call answers with `{error}` and a successful one with `{output}`.
    // Both spellings are observed, not assumed — this session is the only one in
    // the capture where the model managed a call that worked.
    const results = blocksOfType(parse(TOOL_SUCCESS).entries, "tool_result").filter(
      (result) => result["is_error"] !== true,
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results.at(0) && stringField(results[0] ?? {}, "content")).toContain(
      "def average_item_price",
    );
  });

  it("counts telemetry as ignored rather than unreadable", () => {
    const stats = parse(SIMPLE).parseStats;

    // Qwen Code's own instrumentation is not conversation, but it is not a
    // format surprise either. Folding the two together would bury the signal.
    expect(stats.ignored).toBeGreaterThan(0);
    expect(stats.total).toBe(stats.ignored + stats.unparsed + parse(SIMPLE).entries.length);
  });

  it("totals tokens from every API call, not just the ones that spoke", () => {
    // The CLI's own per-session roll-up in usage_record.jsonl reports
    // 6150/884 for this session. The assistant records alone give 2050/129,
    // because two of the three calls ran tools without producing a message.
    const usage = parse(SIMPLE).usage;

    expect(usage.inputTokens).toBe(6150);
    expect(usage.outputTokens).toBe(884);
  });

  it("reports tokens but never a cost", () => {
    // Qwen Code is pointed at whichever OpenAI-compatible provider the user
    // configured, and Lantern only has Anthropic's prices. A number here would
    // be a fabrication.
    expect(parse(TOOLS).usage.costUsd).toBeNull();
    expect(parse(TOOLS).usage.modelName).toBe("qwen3:0.6b");
  });

  it("counts an unreadable line instead of dropping it", () => {
    const parsed = parseChat(["{ not json", '{"type":"user","message":{"role":"user"}}'], {
      sessionKey: "s",
      cwd: "/w",
    });

    expect(parsed.parseStats.unparsed).toBe(1);
    expect(parsed.unparsedLines).toStrictEqual([1]);
  });

  it("ignores a blank trailing line rather than counting it unreadable", () => {
    // Every append leaves one, so treating it as a format surprise would report
    // every healthy session as damaged.
    expect(parseChat(["", ""], { sessionKey: "s", cwd: "/w" }).parseStats.unparsed).toBe(0);
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

    // The first entry starts the chain; every other one points at its
    // predecessor, which is what the viewer threads a conversation by.
    expect(parents).toStrictEqual([undefined, ...uuids.slice(0, -1)]);
  });
});

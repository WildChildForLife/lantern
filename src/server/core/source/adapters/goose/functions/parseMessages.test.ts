import { describe, expect, it } from "vitest";
import { type GooseMessage, parseMessages } from "./parseMessages.ts";

const options = { sessionKey: "s", cwd: "/w", model: "m" };

const message = (parts: unknown, role = "user"): GooseMessage[] => [
  { id: "1", role, contentJson: JSON.stringify(parts), createdMs: 0 },
];

/** The blocks of one type across every entry, whatever carries them. */
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

const toolResponse = (toolResult: unknown) => [{ type: "toolResponse", id: "c1", toolResult }];

describe("parseMessages", () => {
  describe("a tool result Lantern cannot render", () => {
    it("counts an image block rather than dropping it", () => {
      // The block carries no text, so it used to vanish into an empty but
      // successful result with every counter at zero — a whole message's
      // content gone, and nothing to show it had been.
      const parsed = parseMessages(
        message(
          toolResponse({ status: "success", value: { content: [{ type: "image", data: "…" }] } }),
        ),
        options,
      );

      expect(parsed.parseStats.ignored).toBe(1);
      expect(parsed.parseStats.unparsed).toBe(0);
    });

    it("counts a block that is neither text nor a kind known to lack it", () => {
      const parsed = parseMessages(
        message(toolResponse({ status: "success", value: { content: [{ type: "hologram" }] } })),
        options,
      );

      expect(parsed.parseStats.unparsed).toBe(1);
      expect(parsed.unparsedMessages).toStrictEqual(["1#result"]);
    });

    it("still renders the text beside a block it cannot show", () => {
      const parsed = parseMessages(
        message(
          toolResponse({
            status: "success",
            value: {
              content: [
                { type: "text", text: "here" },
                { type: "image", data: "…" },
              ],
            },
          }),
        ),
        options,
      );

      const result = blocksOfType(parsed.entries, "tool_result").at(0);
      expect(result?.["content"]).toBe("here");
      expect(parsed.parseStats.ignored).toBe(1);
    });
  });

  describe("a tool that did not succeed", () => {
    it("treats a status that is not success as a failure", () => {
      // A cancelled call rendered as an empty successful one is
      // indistinguishable from a tool that returned nothing.
      const parsed = parseMessages(message(toolResponse({ status: "cancelled" })), options);
      const result = blocksOfType(parsed.entries, "tool_result").at(0);

      expect(result?.["is_error"]).toBe(true);
    });

    it("treats a successful call that returned an error as a failure", () => {
      const parsed = parseMessages(
        message(
          toolResponse({
            status: "success",
            value: { content: [{ type: "text", text: "no" }], isError: true },
          }),
        ),
        options,
      );
      const result = blocksOfType(parsed.entries, "tool_result").at(0);

      expect(result?.["is_error"]).toBe(true);
      expect(result?.["content"]).toBe("no");
    });

    it("leaves a successful call that returned output alone", () => {
      const parsed = parseMessages(
        message(
          toolResponse({
            status: "success",
            value: { content: [{ type: "text", text: "ok" }], isError: false },
          }),
        ),
        options,
      );
      const result = blocksOfType(parsed.entries, "tool_result").at(0);

      expect(result?.["is_error"]).toBe(false);
      expect(result?.["content"]).toBe("ok");
    });
  });

  it("names the part it could not read, not just the message", () => {
    // Keyed per message, three bad parts in one message reported as "1, 1, 1".
    const parsed = parseMessages(
      message([{ type: "who" }, { type: "knows" }, { type: "what" }], "assistant"),
      options,
    );

    expect(parsed.parseStats.unparsed).toBe(3);
    expect(parsed.unparsedMessages).toStrictEqual(["1#0", "1#1", "1#2"]);
  });

  it("counts a message whose content is not JSON", () => {
    const parsed = parseMessages(
      [{ id: "9", role: "user", contentJson: "", createdMs: 0 }],
      options,
    );

    expect(parsed.parseStats.unparsed).toBe(1);
    expect(parsed.entries).toStrictEqual([]);
  });
});

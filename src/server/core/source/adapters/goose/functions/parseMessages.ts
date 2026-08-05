import { z } from "zod";
import type { Conversation } from "../../../../../../lib/conversation-schema/index.ts";
import type { AssistantMessageContent } from "../../../../../../lib/conversation-schema/message/AssistantMessageSchema.ts";
import {
  linkParents,
  syntheticEntryUuid,
} from "../../../../../../lib/conversation-schema/synthetic/entryIdentity.ts";
import type { ExtendedConversation } from "../../../../../../types/conversation.ts";
import type { ParseStats } from "../../../models/SourceEntities.ts";
import { GOOSE_SOURCE_ID } from "../../../models/SourceId.ts";

/**
 * goose keeps one row per message, and the message itself in a `content_json`
 * column: an array of parts, each tagged by `type`.
 *
 * The dialect is goose's own — nothing like opencode's parts, despite both
 * living in SQLite. That is why the read-only database reader is shared and
 * this parser is not.
 *
 * Established by running goose 1.45.0 in `docker/` and reading what it wrote.
 * The fixture under `fixtures/goose-home/` is that database, checkpointed into
 * a single file.
 *
 * Only the shapes Lantern renders are modelled. Everything else is *recognised
 * and ignored* rather than dropped silently — a part that is neither rendered
 * nor named is counted unreadable, because a format that moved has to be
 * distinguishable from one that is simply not conversation.
 */

const textPartSchema = z.looseObject({ type: z.literal("text"), text: z.string() });

const thinkingPartSchema = z.looseObject({
  type: z.literal("thinking"),
  thinking: z.string(),
});

const toolRequestSchema = z.looseObject({
  type: z.literal("toolRequest"),
  id: z.string(),
  toolCall: z.looseObject({
    status: z.string().optional(),
    value: z
      .looseObject({
        name: z.string().optional(),
        arguments: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
  }),
});

/** The text blocks a tool returns when the call itself succeeded. */
const toolOutputSchema = z.looseObject({
  content: z.array(z.looseObject({ text: z.string().optional() })).optional(),
  isError: z.boolean().optional(),
});

const toolResponseSchema = z.looseObject({
  type: z.literal("toolResponse"),
  id: z.string(),
  toolResult: z.looseObject({
    status: z.string().optional(),
    error: z.string().optional(),
    value: toolOutputSchema.optional(),
  }),
});

const typedPartSchema = z.looseObject({ type: z.string() });

/**
 * Part types goose writes that are not conversation.
 *
 * Naming them is the point: anything not listed and not rendered is counted
 * unreadable, so a shape that appears after a format change shows up as a
 * number rather than as a turn that quietly went missing.
 */
const IGNORED_PART_TYPES = new Set([
  "frontendToolRequest",
  "toolConfirmationRequest",
  "contextLengthExceeded",
  "summarizationRequested",
]);

export type GooseMessage = {
  /** goose's own id for the row, reported when a message will not read. */
  readonly id: string;
  readonly role: string;
  readonly contentJson: string;
  readonly createdMs: number;
};

export type ParsedGooseMessages = {
  readonly entries: readonly ExtendedConversation[];
  readonly messageCount: number;
  readonly parseStats: ParseStats;
  readonly unparsedMessages: readonly string[];
};

/**
 * A tool's outcome, as one piece of text and whether it failed.
 *
 * goose reports failure at two levels, and both mean the user did not get what
 * they asked for: `status: "error"` is the call never running, while a
 * successful call can still return `isError` on its own result.
 */
const toolOutcome = (
  result: z.infer<typeof toolResponseSchema>["toolResult"],
): { text: string; error: boolean } => {
  if (result.status === "error") {
    return { text: result.error ?? "", error: true };
  }

  const value = toolOutputSchema.safeParse(result.value);
  if (!value.success) {
    return { text: "", error: false };
  }

  const text = (value.data.content ?? [])
    .map((block) => block.text ?? "")
    .filter((block) => block !== "")
    .join("\n");

  return { text, error: value.data.isError === true };
};

export const parseMessages = (
  messages: readonly GooseMessage[],
  options: { readonly sessionKey: string; readonly cwd: string; readonly model: string },
): ParsedGooseMessages => {
  const unparsedMessages: string[] = [];
  let ignored = 0;
  let unparsed = 0;

  const pending: Array<(uuid: string) => Conversation & { uuid: string }> = [];

  const recordUnparsed = (id: string) => {
    unparsed += 1;
    if (unparsedMessages.length < 3) unparsedMessages.push(id);
  };

  const base = (createdMs: number) => ({
    isSidechain: false,
    userType: "external" as const,
    version: "unknown",
    timestamp: new Date(createdMs).toISOString(),
    cwd: options.cwd,
    sessionId: options.sessionKey,
  });

  type EntryBase = ReturnType<typeof base>;

  const pushAssistant = (entryBase: EntryBase, content: AssistantMessageContent[]) => {
    pending.push((uuid) => ({
      ...entryBase,
      type: "assistant",
      uuid,
      parentUuid: null,
      message: {
        id: uuid,
        type: "message",
        role: "assistant",
        model: options.model,
        content,
        stop_reason: null,
        stop_sequence: null,
      },
    }));
  };

  for (const message of messages) {
    let parts: unknown;
    try {
      parts = JSON.parse(message.contentJson);
    } catch {
      recordUnparsed(message.id);
      continue;
    }

    if (!Array.isArray(parts)) {
      recordUnparsed(message.id);
      continue;
    }

    const entryBase = base(message.createdMs);

    /**
     * goose streams reasoning and prose in chunks — one part per token, each
     * `{type:"thinking", thinking:"Okay"}`. Rendered one entry per part, a
     * single turn became hundreds of blocks of one word each. A run of the same
     * kind is one block, which is what it was before it was streamed.
     */
    let runKind: "thinking" | "text" | null = null;
    let runText = "";

    const flushRun = () => {
      if (runKind === null || runText === "") {
        runKind = null;
        runText = "";
        return;
      }

      if (runKind === "thinking") {
        pushAssistant(entryBase, [{ type: "thinking", thinking: runText }]);
      } else if (message.role === "user") {
        const text = runText;
        pending.push((uuid) => ({
          ...entryBase,
          type: "user",
          uuid,
          parentUuid: null,
          message: { role: "user", content: text },
        }));
      } else {
        pushAssistant(entryBase, [{ type: "text", text: runText }]);
      }

      runKind = null;
      runText = "";
    };

    const appendRun = (kind: "thinking" | "text", chunk: string) => {
      if (runKind !== kind) flushRun();
      runKind = kind;
      // Chunks are fragments of one sentence, so they join without a separator.
      runText += chunk;
    };

    for (const part of parts) {
      const request = toolRequestSchema.safeParse(part);
      if (request.success) {
        flushRun();
        pushAssistant(entryBase, [
          {
            type: "tool_use",
            id: request.data.id,
            name: request.data.toolCall.value?.name ?? "unknown",
            input: request.data.toolCall.value?.arguments ?? {},
          },
        ]);
        continue;
      }

      const response = toolResponseSchema.safeParse(part);
      if (response.success) {
        flushRun();
        const outcome = toolOutcome(response.data.toolResult);
        pending.push((uuid) => ({
          ...entryBase,
          type: "user",
          uuid,
          parentUuid: null,
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: response.data.id,
                content: outcome.text,
                is_error: outcome.error,
              },
            ],
          },
        }));
        continue;
      }

      const thinking = thinkingPartSchema.safeParse(part);
      if (thinking.success) {
        if (thinking.data.thinking === "") {
          ignored += 1;
          continue;
        }
        appendRun("thinking", thinking.data.thinking);
        continue;
      }

      const text = textPartSchema.safeParse(part);
      if (text.success) {
        if (text.data.text === "") {
          ignored += 1;
          continue;
        }
        appendRun("text", text.data.text);
        continue;
      }

      const typed = typedPartSchema.safeParse(part);
      if (typed.success && IGNORED_PART_TYPES.has(typed.data.type)) {
        ignored += 1;
        continue;
      }

      recordUnparsed(message.id);
    }

    flushRun();
  }

  const entries = linkParents(
    pending.map((build, index) =>
      build(syntheticEntryUuid(GOOSE_SOURCE_ID, options.sessionKey, index)),
    ),
  );

  return {
    entries,
    messageCount: entries.length,
    parseStats: {
      total: entries.length + ignored + unparsed,
      ignored,
      unparsed,
    },
    unparsedMessages,
  };
};

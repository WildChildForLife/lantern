import { z } from "zod";
import type { Conversation } from "../../../../../../lib/conversation-schema/index.ts";
import {
  linkParents,
  syntheticEntryUuid,
} from "../../../../../../lib/conversation-schema/synthetic/entryIdentity.ts";
import type { ExtendedConversation } from "../../../../../../types/conversation.ts";
import type { ParseStats } from "../../../models/SourceEntities.ts";
import { CODEX_SOURCE_ID } from "../../../models/SourceId.ts";

/**
 * Codex writes one JSON object per line: a timestamp, a line type, and a
 * payload whose own `type` says what it is.
 *
 * Only the shapes Lantern renders are modelled. Everything else is *recognised
 * and ignored* rather than dropped silently — an unparsed line is a signal that
 * the format moved, and it has to stay distinguishable from one that is simply
 * not interesting.
 */
const contentPartSchema = z.union([
  z.object({ type: z.literal("input_text"), text: z.string() }),
  z.object({ type: z.literal("output_text"), text: z.string() }),
  z.object({ type: z.literal("text"), text: z.string() }),
  z.looseObject({ type: z.string() }),
]);

const messagePayloadSchema = z.object({
  type: z.literal("message"),
  role: z.string(),
  content: z.array(contentPartSchema).default([]),
});

const functionCallPayloadSchema = z.object({
  type: z.literal("function_call"),
  name: z.string(),
  arguments: z.string().default(""),
  call_id: z.string().default(""),
});

const functionCallOutputPayloadSchema = z.object({
  type: z.literal("function_call_output"),
  call_id: z.string().default(""),
  output: z.unknown(),
});

const sessionMetaPayloadSchema = z.looseObject({
  id: z.string().optional(),
  cwd: z.string().optional(),
  cli_version: z.string().optional(),
  timestamp: z.string().optional(),
});

const turnContextPayloadSchema = z.looseObject({
  model: z.string().optional(),
  cwd: z.string().optional(),
});

const reasoningPayloadSchema = z.object({
  type: z.literal("reasoning"),
  summary: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })).default([]),
});

const rolloutLineSchema = z.object({
  timestamp: z.string().optional(),
  type: z.string(),
  payload: z.unknown(),
});

/**
 * `response_item` kinds Lantern knowingly skips.
 *
 * Naming them is the point. An unparsed line means the format moved, and that
 * signal is worthless if every kind this adapter merely does not render counts
 * as one — which is what "anything I did not match" amounts to. A kind listed
 * here is a decision; a kind that reaches the unparsed count is news.
 */
const IGNORED_RESPONSE_ITEMS = new Set([
  "local_shell_call",
  "local_shell_call_output",
  "custom_tool_call",
  "custom_tool_call_output",
  "web_search_call",
  "file_search_call",
  "image_generation_call",
  "code_interpreter_call",
  "computer_call",
  "computer_call_output",
  "mcp_call",
  "mcp_list_tools",
  "mcp_approval_request",
  "mcp_approval_response",
  "item_reference",
  "other",
]);

export type RolloutSessionMeta = {
  readonly sessionId: string | null;
  readonly cwd: string | null;
  readonly cliVersion: string;
  readonly model: string | null;
  readonly startedAt: string | null;
};

export type ParsedRollout = {
  readonly meta: RolloutSessionMeta;
  readonly entries: readonly ExtendedConversation[];
  readonly messageCount: number;
  readonly parseStats: ParseStats;
  /** The first few lines that did not parse, for the log. */
  readonly unparsedLines: readonly string[];
};

/**
 * Wrappers Codex injects as `user` turns: session scaffolding rather than
 * anything a person typed.
 */
const INJECTED_CONTEXT_TAGS = ["environment_context", "user_instructions"];

const isInjectedContext = (text: string): boolean => {
  const trimmed = text.trim();
  // The whole turn has to be the block. A message that merely mentions one —
  // asking about it, quoting it — is conversation and must survive.
  return INJECTED_CONTEXT_TAGS.some(
    (tag) => trimmed.startsWith(`<${tag}>`) && trimmed.endsWith(`</${tag}>`),
  );
};

const textOf = (content: readonly z.infer<typeof contentPartSchema>[]): string =>
  content
    .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
    .filter((text) => text !== "")
    .join("\n");

const outputText = (output: unknown): string => {
  if (typeof output === "string") return output;
  if (output === null || output === undefined) return "";

  const asRecord = z.looseObject({ output: z.string() }).safeParse(output);
  return asRecord.success ? asRecord.data.output : JSON.stringify(output);
};

/**
 * Translates one rollout file into Claude-shaped conversation entries.
 *
 * The base fields every entry needs — uuid, parent, cwd, session id — are
 * synthesised from the session's own identity, so re-reading the same file
 * always produces the same entries.
 */
export const parseRollout = (content: string, sessionKey: string): ParsedRollout => {
  const lines = content.split("\n");
  const unparsedLines: string[] = [];
  const recordUnparsed = (line: string, lineNumber: number) => {
    if (unparsedLines.length < 3) {
      unparsedLines.push(`line ${lineNumber}: ${line.slice(0, 200)}`);
    }
  };

  let sessionId: string | null = null;
  let cwd: string | null = null;
  let cliVersion = "unknown";
  let model: string | null = null;
  let startedAt: string | null = null;

  // Counted rather than collected: an unparsed line means the format moved and
  // has to stay distinguishable from one that is simply not interesting.
  let ignored = 0;
  let unparsed = 0;
  const pending: Array<(uuid: string) => Conversation & { uuid: string }> = [];

  /**
   * The fields every entry carries, read *now*.
   *
   * Deliberately not a closure over the running state. Entries are built after
   * the loop, once their uuids exist, so a builder that read `model` or `cwd`
   * when it ran would stamp every entry in the file with the last turn's model
   * — and a session that switched models would report only the one it ended on.
   */
  const base = (timestamp: string) => ({
    isSidechain: false,
    userType: "external" as const,
    version: cliVersion,
    timestamp,
    cwd: cwd ?? "",
    sessionId: sessionId ?? sessionKey,
  });

  for (const [lineNumber, line] of lines.entries()) {
    if (line.trim() === "") continue;

    const json = ((): unknown => {
      try {
        return JSON.parse(line);
      } catch {
        return undefined;
      }
    })();

    const parsedLine = rolloutLineSchema.safeParse(json);
    if (!parsedLine.success) {
      unparsed += 1;
      recordUnparsed(line, lineNumber + 1);
      continue;
    }

    const { type, payload } = parsedLine.data;
    const timestamp = parsedLine.data.timestamp ?? startedAt ?? new Date(0).toISOString();

    if (type === "session_meta") {
      const meta = sessionMetaPayloadSchema.safeParse(payload);
      if (meta.success) {
        sessionId = meta.data.id ?? sessionId;
        cwd = meta.data.cwd ?? cwd;
        cliVersion = meta.data.cli_version ?? cliVersion;
        startedAt = meta.data.timestamp ?? parsedLine.data.timestamp ?? startedAt;
      }
      ignored += 1;
      continue;
    }

    if (type === "turn_context") {
      const context = turnContextPayloadSchema.safeParse(payload);
      if (context.success) {
        model = context.data.model ?? model;
        cwd = cwd ?? context.data.cwd ?? null;
      }
      ignored += 1;
      continue;
    }

    if (type === "event_msg") {
      ignored += 1;
      continue;
    }

    if (type !== "response_item") {
      ignored += 1;
      continue;
    }

    // Read once per line and closed over by value. The model in particular
    // changes mid-file whenever a turn switches it.
    const entryBase = base(timestamp);
    const turnModel = model ?? "unknown";

    const message = messagePayloadSchema.safeParse(payload);
    if (message.success) {
      const text = textOf(message.data.content);
      const role = message.data.role;

      // Codex records the harness's own instructions as `developer`/`system`
      // turns. They are not conversation.
      if (role !== "user" && role !== "assistant") {
        ignored += 1;
        continue;
      }

      // Codex opens every session by injecting the working directory, shell and
      // sandbox policy as a `user` turn. Nobody typed it. Left in, it becomes
      // the first user message — which is what the conversation list shows as
      // the session's title, so every Codex session would be titled with a
      // block of XML instead of what was asked.
      if (role === "user" && isInjectedContext(text)) {
        ignored += 1;
        continue;
      }

      pending.push((uuid) =>
        role === "user"
          ? {
              ...entryBase,
              type: "user",
              uuid,
              parentUuid: null,
              message: { role: "user", content: text },
            }
          : {
              ...entryBase,
              type: "assistant",
              uuid,
              parentUuid: null,
              message: {
                id: uuid,
                type: "message",
                role: "assistant",
                model: turnModel,
                content: [{ type: "text", text }],
                stop_reason: null,
                stop_sequence: null,
              },
            },
      );
      continue;
    }

    const call = functionCallPayloadSchema.safeParse(payload);
    if (call.success) {
      const input = ((): Record<string, unknown> => {
        try {
          const parsed: unknown = JSON.parse(call.data.arguments);
          return typeof parsed === "object" && parsed !== null
            ? { ...parsed }
            : { arguments: call.data.arguments };
        } catch {
          return { arguments: call.data.arguments };
        }
      })();

      pending.push((uuid) => ({
        ...entryBase,
        type: "assistant",
        uuid,
        parentUuid: null,
        message: {
          id: uuid,
          type: "message",
          role: "assistant",
          model: turnModel,
          content: [
            {
              type: "tool_use",
              id: call.data.call_id === "" ? uuid : call.data.call_id,
              name: call.data.name,
              input,
            },
          ],
          stop_reason: null,
          stop_sequence: null,
        },
      }));
      continue;
    }

    const output = functionCallOutputPayloadSchema.safeParse(payload);
    if (output.success) {
      const text = outputText(output.data.output);

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
              tool_use_id: output.data.call_id === "" ? uuid : output.data.call_id,
              content: text,
            },
          ],
        },
      }));
      continue;
    }

    // Codex's reasoning summaries are shown in its own transcript, so they are
    // conversation rather than bookkeeping. A summary with no text is the
    // common case when reasoning summaries are turned off — nothing to render.
    const reasoning = reasoningPayloadSchema.safeParse(payload);
    if (reasoning.success) {
      const text = reasoning.data.summary
        .map((part) => part.text ?? "")
        .filter((part) => part !== "")
        .join("\n");

      if (text === "") {
        ignored += 1;
        continue;
      }

      pending.push((uuid) => ({
        ...entryBase,
        type: "assistant",
        uuid,
        parentUuid: null,
        message: {
          id: uuid,
          type: "message",
          role: "assistant",
          model: turnModel,
          content: [{ type: "thinking", thinking: text }],
          stop_reason: null,
          stop_sequence: null,
        },
      }));
      continue;
    }

    const kind = z.looseObject({ type: z.string() }).safeParse(payload);
    if (kind.success && IGNORED_RESPONSE_ITEMS.has(kind.data.type)) {
      ignored += 1;
      continue;
    }

    unparsed += 1;
    recordUnparsed(line, lineNumber + 1);
  }

  const entries = linkParents(
    pending.map((build, index) => build(syntheticEntryUuid(CODEX_SOURCE_ID, sessionKey, index))),
  );

  return {
    meta: { sessionId, cwd, cliVersion, model, startedAt },
    entries,
    messageCount: entries.length,
    parseStats: {
      total: entries.length + ignored + unparsed,
      ignored,
      unparsed,
    },
    unparsedLines,
  };
};

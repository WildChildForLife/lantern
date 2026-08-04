import { z } from "zod";
import type { Conversation } from "../../../../../../lib/conversation-schema/index.ts";
import {
  linkParents,
  syntheticEntryUuid,
} from "../../../../../../lib/conversation-schema/synthetic/entryIdentity.ts";
import type { ExtendedConversation } from "../../../../../../types/conversation.ts";
import type { ParseStats } from "../../../models/SourceEntities.ts";
import { OPENCODE_SOURCE_ID } from "../../../models/SourceId.ts";

/**
 * opencode writes one JSON file per message under
 * `storage/message/<sessionID>/<messageID>.json`. Every message carries a
 * `type` that says which of eight shapes it is, and an assistant message
 * carries its content inline as an array of text, reasoning and tool parts.
 *
 * Only the shapes Lantern renders are modelled. Everything else is *recognised
 * and ignored* rather than dropped silently — an unparsed message means the
 * format moved, and that has to stay distinguishable from one that is simply
 * not conversation.
 */
const toolStateSchema = z.looseObject({
  status: z.string(),
  input: z.record(z.string(), z.unknown()).optional(),
  output: z.string().optional(),
  error: z.unknown().optional(),
});

const assistantContentSchema = z.union([
  z.object({ type: z.literal("text"), id: z.string().optional(), text: z.string() }),
  z.object({ type: z.literal("reasoning"), id: z.string().optional(), text: z.string() }),
  z.looseObject({
    type: z.literal("tool"),
    id: z.string().optional(),
    name: z.string(),
    state: toolStateSchema.optional(),
  }),
  z.looseObject({ type: z.string() }),
]);

const baseSchema = {
  id: z.string().optional(),
  time: z.looseObject({ created: z.number().optional() }).optional(),
};

const userMessageSchema = z.looseObject({
  ...baseSchema,
  type: z.literal("user"),
  text: z.string().default(""),
});

const assistantMessageSchema = z.looseObject({
  ...baseSchema,
  type: z.literal("assistant"),
  model: z.unknown().optional(),
  content: z.array(assistantContentSchema).default([]),
  cost: z.number().optional(),
  tokens: z
    .looseObject({
      input: z.number().optional(),
      output: z.number().optional(),
      reasoning: z.number().optional(),
      cache: z
        .looseObject({ read: z.number().optional(), write: z.number().optional() })
        .optional(),
    })
    .optional(),
});

const shellMessageSchema = z.looseObject({
  ...baseSchema,
  type: z.literal("shell"),
  callID: z.string().default(""),
  command: z.string().default(""),
  output: z.string().default(""),
});

const typedMessageSchema = z.looseObject({ type: z.string() });

/**
 * Message types opencode writes that are not conversation.
 *
 * Naming them is the point. `synthetic` and `system` are prompt scaffolding the
 * CLI injects, and the `-switched` records are UI bookkeeping. Letting them
 * fall through to the unparsed count would mean the count no longer says
 * anything about whether the format moved.
 */
const IGNORED_MESSAGE_TYPES = new Set([
  "synthetic",
  "system",
  "agent-switched",
  "model-switched",
  "compaction",
]);

/**
 * opencode names a model as a provider/model pair rather than a string. Only
 * the model part is a name Lantern's pricing would recognise, and neither is
 * trusted to exist.
 */
const modelRefSchema = z.union([
  z.string(),
  z.looseObject({ providerID: z.string().optional(), modelID: z.string().optional() }),
]);

const modelName = (value: unknown): string => {
  const parsed = modelRefSchema.safeParse(value);
  if (!parsed.success) return "unknown";
  if (typeof parsed.data === "string") return parsed.data;
  return parsed.data.modelID ?? "unknown";
};

export type OpencodeUsage = {
  readonly costUsd: number | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
};

export type ParsedMessages = {
  readonly entries: readonly ExtendedConversation[];
  readonly messageCount: number;
  readonly modelName: string | null;
  /**
   * What the CLI itself recorded spending. opencode is one of the few that
   * writes a cost per assistant turn, so Lantern never has to estimate it.
   */
  readonly usage: OpencodeUsage;
  readonly parseStats: ParseStats;
  readonly unparsedFiles: readonly string[];
};

/** One message file, still in the order its filename sorts to. */
export type MessageFile = {
  readonly fileName: string;
  readonly json: unknown;
};

const toolResultText = (state: z.infer<typeof toolStateSchema> | undefined): string => {
  if (state === undefined) return "";
  if (typeof state.output === "string" && state.output !== "") return state.output;
  if (state.error !== undefined && state.error !== null) return JSON.stringify(state.error);
  return "";
};

/**
 * Translates a session's message files into Claude-shaped conversation entries.
 *
 * The base fields every entry needs — uuid, parent, cwd, session id — are
 * synthesised from the session's own identity, so re-reading the same session
 * always produces the same entries.
 */
export const parseMessages = (
  files: readonly MessageFile[],
  options: { readonly sessionKey: string; readonly cwd: string; readonly version: string },
): ParsedMessages => {
  const unparsedFiles: string[] = [];
  let ignored = 0;
  let unparsed = 0;
  let lastModel: string | null = null;

  let costUsd: number | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;

  const pending: Array<(uuid: string) => Conversation & { uuid: string }> = [];

  const base = (createdMs: number | undefined) => ({
    isSidechain: false,
    userType: "external" as const,
    version: options.version,
    timestamp: new Date(createdMs ?? 0).toISOString(),
    cwd: options.cwd,
    sessionId: options.sessionKey,
  });

  for (const { fileName, json } of files) {
    const typed = typedMessageSchema.safeParse(json);
    if (!typed.success) {
      unparsed += 1;
      if (unparsedFiles.length < 3) unparsedFiles.push(fileName);
      continue;
    }

    if (IGNORED_MESSAGE_TYPES.has(typed.data.type)) {
      ignored += 1;
      continue;
    }

    const user = userMessageSchema.safeParse(json);
    if (user.success) {
      const entryBase = base(user.data.time?.created);
      const text = user.data.text;

      pending.push((uuid) => ({
        ...entryBase,
        type: "user",
        uuid,
        parentUuid: null,
        message: { role: "user", content: text },
      }));
      continue;
    }

    const assistant = assistantMessageSchema.safeParse(json);
    if (assistant.success) {
      const entryBase = base(assistant.data.time?.created);
      const model = modelName(assistant.data.model);
      lastModel = model === "unknown" ? lastModel : model;

      if (typeof assistant.data.cost === "number") {
        costUsd = (costUsd ?? 0) + assistant.data.cost;
      }
      inputTokens += assistant.data.tokens?.input ?? 0;
      outputTokens += assistant.data.tokens?.output ?? 0;
      cacheReadTokens += assistant.data.tokens?.cache?.read ?? 0;
      cacheCreationTokens += assistant.data.tokens?.cache?.write ?? 0;

      // One opencode message holds a whole turn. Its tool parts become the
      // tool_use/tool_result pairs the viewer threads, which means one message
      // can produce several entries.
      for (const part of assistant.data.content) {
        if (part.type === "text" && "text" in part && typeof part.text === "string") {
          const text = part.text;
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
              model,
              content: [{ type: "text", text }],
              stop_reason: null,
              stop_sequence: null,
            },
          }));
          continue;
        }

        if (part.type === "reasoning" && "text" in part && typeof part.text === "string") {
          const text = part.text;
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
              model,
              content: [{ type: "thinking", thinking: text }],
              stop_reason: null,
              stop_sequence: null,
            },
          }));
          continue;
        }

        const tool = assistantContentSchema.options[2].safeParse(part);
        if (tool.success) {
          const callId = tool.data.id ?? "";
          const state = toolStateSchema.safeParse(tool.data.state);
          const input = state.success ? (state.data.input ?? {}) : {};
          const output = state.success ? toolResultText(state.data) : "";

          pending.push((uuid) => ({
            ...entryBase,
            type: "assistant",
            uuid,
            parentUuid: null,
            message: {
              id: uuid,
              type: "message",
              role: "assistant",
              model,
              content: [
                {
                  type: "tool_use",
                  id: callId === "" ? uuid : callId,
                  name: tool.data.name,
                  input,
                },
              ],
              stop_reason: null,
              stop_sequence: null,
            },
          }));

          // A tool part that has not finished has no result to show yet.
          if (output === "") continue;

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
                  tool_use_id: callId === "" ? uuid : callId,
                  content: output,
                },
              ],
            },
          }));
          continue;
        }

        ignored += 1;
      }
      continue;
    }

    // A shell message is a command the user ran through the CLI rather than a
    // turn. It reads like a tool call, so it is shown as one.
    const shell = shellMessageSchema.safeParse(json);
    if (shell.success) {
      const entryBase = base(shell.data.time?.created);
      const callId = shell.data.callID === "" ? shell.data.id : shell.data.callID;

      pending.push((uuid) => ({
        ...entryBase,
        type: "assistant",
        uuid,
        parentUuid: null,
        message: {
          id: uuid,
          type: "message",
          role: "assistant",
          model: lastModel ?? "unknown",
          content: [
            {
              type: "tool_use",
              id: callId === undefined || callId === "" ? uuid : callId,
              name: "shell",
              input: { command: shell.data.command },
            },
          ],
          stop_reason: null,
          stop_sequence: null,
        },
      }));

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
              tool_use_id: callId === undefined || callId === "" ? uuid : callId,
              content: shell.data.output,
            },
          ],
        },
      }));
      continue;
    }

    unparsed += 1;
    if (unparsedFiles.length < 3) unparsedFiles.push(fileName);
  }

  const entries = linkParents(
    pending.map((build, index) =>
      build(syntheticEntryUuid(OPENCODE_SOURCE_ID, options.sessionKey, index)),
    ),
  );

  return {
    entries,
    messageCount: entries.length,
    modelName: lastModel,
    usage: { costUsd, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens },
    parseStats: {
      total: entries.length + ignored + unparsed,
      ignored,
      unparsed,
    },
    unparsedFiles,
  };
};

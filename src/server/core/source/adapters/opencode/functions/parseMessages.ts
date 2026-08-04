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
 * `storage/message/<sessionID>/<messageID>.json`, and has done so in two
 * shapes:
 *
 *   v1  the message is `{role, ...}` and its text, reasoning and tool parts are
 *       separate files under `storage/part/<messageID>/<partID>.json`
 *   v2  the message is `{type, ...}` and an assistant message carries the same
 *       parts inline as `content`
 *
 * Both are read. The two differ only in where the parts live and in what a tool
 * part calls its name and its call id, so one renderer handles both spellings.
 *
 * Only the shapes Lantern renders are modelled. Everything else is *recognised
 * and ignored* rather than dropped silently — a part shape that is neither
 * rendered nor named is counted unreadable, because a format that moved has to
 * be distinguishable from one that is simply not conversation.
 */
const toolStateSchema = z.looseObject({
  status: z.string(),
  input: z.record(z.string(), z.unknown()).optional(),
  output: z.string().optional(),
  error: z.unknown().optional(),
});

const textPartSchema = z.looseObject({
  type: z.literal("text"),
  text: z.string(),
  /** v1 marks harness-injected text so the CLI can hide it. So does Lantern. */
  synthetic: z.boolean().optional(),
  ignored: z.boolean().optional(),
});

const reasoningPartSchema = z.looseObject({
  type: z.literal("reasoning"),
  text: z.string(),
});

const toolPartSchema = z.looseObject({
  type: z.literal("tool"),
  /** `tool` in v1, `name` in v2. */
  tool: z.string().optional(),
  name: z.string().optional(),
  /** `callID` in v1, the part's own `id` in v2. */
  callID: z.string().optional(),
  id: z.string().optional(),
  state: toolStateSchema.optional(),
});

const typedShapeSchema = z.looseObject({ type: z.string() });

/**
 * Part types opencode writes that are not conversation.
 *
 * Naming them is the point. Anything not listed and not rendered is counted
 * unreadable, so a part shape that appears after a format change shows up as a
 * number rather than as a turn that quietly went missing.
 */
const IGNORED_PART_TYPES = new Set([
  "snapshot",
  "patch",
  "file",
  "step-start",
  "step-finish",
  "agent",
]);

/**
 * Message types that are not conversation: `synthetic` and `system` are prompt
 * scaffolding the CLI injects, and the `-switched` records are bookkeeping.
 */
const IGNORED_MESSAGE_TYPES = new Set([
  "synthetic",
  "system",
  "agent-switched",
  "model-switched",
  "compaction",
]);

const baseFields = {
  id: z.string().optional(),
  time: z.looseObject({ created: z.number().optional() }).optional(),
};

/** v2: the shape is named by `type`. */
const v2UserSchema = z.looseObject({ ...baseFields, type: z.literal("user"), text: z.string() });

const v2AssistantSchema = z.looseObject({
  ...baseFields,
  type: z.literal("assistant"),
  model: z.unknown().optional(),
  content: z.array(z.unknown()).optional(),
  cost: z.number().optional(),
  tokens: z.unknown().optional(),
});

const v2ShellSchema = z.looseObject({
  ...baseFields,
  type: z.literal("shell"),
  callID: z.string().optional(),
  command: z.string().default(""),
  output: z.string().default(""),
});

/** v1: the shape is named by `role`, and the parts live elsewhere. */
const v1MessageSchema = z.looseObject({
  ...baseFields,
  role: z.enum(["user", "assistant"]),
  modelID: z.string().optional(),
  providerID: z.string().optional(),
  cost: z.number().optional(),
  tokens: z.unknown().optional(),
  path: z.looseObject({ cwd: z.string().optional() }).optional(),
});

const tokensSchema = z.looseObject({
  input: z.number().optional(),
  output: z.number().optional(),
  cache: z.looseObject({ read: z.number().optional(), write: z.number().optional() }).optional(),
});

/**
 * opencode names a model as a provider/model pair rather than a string. Only
 * the model part is a name a price table would recognise, and neither is
 * trusted to exist.
 */
const modelRefSchema = z.union([
  z.string(),
  z.looseObject({ providerID: z.string().optional(), modelID: z.string().optional() }),
]);

const modelName = (value: unknown): string | null => {
  const parsed = modelRefSchema.safeParse(value);
  if (!parsed.success) return null;
  if (typeof parsed.data === "string") return parsed.data;
  return parsed.data.modelID ?? null;
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
  /** The working directory v1 records on each assistant message, if it did. */
  readonly cwd: string | null;
  /**
   * What the CLI itself recorded spending. opencode is one of the few that
   * writes a cost per assistant turn, so Lantern never has to estimate it.
   */
  readonly usage: OpencodeUsage;
  readonly parseStats: ParseStats;
  readonly unparsedFiles: readonly string[];
};

/**
 * One message file, and — for the version that stores them separately — the
 * part files belonging to it, both already in the order their names sort to.
 */
export type MessageFile = {
  readonly fileName: string;
  readonly json: unknown;
  readonly parts?: readonly unknown[];
};

const toolResultText = (state: z.infer<typeof toolStateSchema> | undefined): string => {
  if (state === undefined) return "";
  if (typeof state.output === "string" && state.output !== "") return state.output;
  if (typeof state.error === "string" && state.error !== "") return state.error;
  if (state.error !== undefined && state.error !== null) return JSON.stringify(state.error);
  return "";
};

/**
 * Translates a session's messages into Claude-shaped conversation entries.
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
  let recordedCwd: string | null = null;

  let costUsd: number | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;

  const pending: Array<(uuid: string) => Conversation & { uuid: string }> = [];

  const recordUnparsed = (fileName: string) => {
    unparsed += 1;
    if (unparsedFiles.length < 3) unparsedFiles.push(fileName);
  };

  const base = (createdMs: number | undefined) => ({
    isSidechain: false,
    userType: "external" as const,
    version: options.version,
    timestamp: new Date(createdMs ?? 0).toISOString(),
    cwd: options.cwd,
    sessionId: options.sessionKey,
  });

  const addUsage = (cost: number | undefined, tokens: unknown) => {
    if (typeof cost === "number") {
      costUsd = (costUsd ?? 0) + cost;
    }

    const parsed = tokensSchema.safeParse(tokens);
    if (!parsed.success) return;

    inputTokens += parsed.data.input ?? 0;
    outputTokens += parsed.data.output ?? 0;
    cacheReadTokens += parsed.data.cache?.read ?? 0;
    cacheCreationTokens += parsed.data.cache?.write ?? 0;
  };

  const pushText = (entryBase: ReturnType<typeof base>, model: string, text: string) => {
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
  };

  const pushThinking = (entryBase: ReturnType<typeof base>, model: string, thinking: string) => {
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
        content: [{ type: "thinking", thinking }],
        stop_reason: null,
        stop_sequence: null,
      },
    }));
  };

  const pushToolPair = (
    entryBase: ReturnType<typeof base>,
    model: string,
    call: { readonly id: string; readonly name: string; readonly input: Record<string, unknown> },
    output: string,
  ) => {
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
            id: call.id === "" ? uuid : call.id,
            name: call.name,
            input: call.input,
          },
        ],
        stop_reason: null,
        stop_sequence: null,
      },
    }));

    // A tool that has not finished has no result to show yet. An unpaired call
    // is ordinary in a transcript of an interrupted turn, and renders.
    if (output === "") return;

    pending.push((uuid) => ({
      ...entryBase,
      type: "user",
      uuid,
      parentUuid: null,
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: call.id === "" ? uuid : call.id, content: output },
        ],
      },
    }));
  };

  /**
   * Renders the parts of one assistant turn, wherever they came from.
   *
   * Returns the text of any user-role text parts, which v1 keeps here rather
   * than on the message.
   */
  const renderParts = (
    parts: readonly unknown[],
    entryBase: ReturnType<typeof base>,
    model: string,
    fileName: string,
    collectTextInsteadOfRendering: boolean,
  ): string => {
    const collected: string[] = [];

    for (const part of parts) {
      const text = textPartSchema.safeParse(part);
      if (text.success) {
        // v1 flags harness-injected text; it is not something the user wrote.
        if (text.data.synthetic === true || text.data.ignored === true || text.data.text === "") {
          ignored += 1;
          continue;
        }
        if (collectTextInsteadOfRendering) {
          collected.push(text.data.text);
          continue;
        }
        pushText(entryBase, model, text.data.text);
        continue;
      }

      const reasoning = reasoningPartSchema.safeParse(part);
      if (reasoning.success) {
        if (reasoning.data.text === "") {
          ignored += 1;
          continue;
        }
        pushThinking(entryBase, model, reasoning.data.text);
        continue;
      }

      const tool = toolPartSchema.safeParse(part);
      if (tool.success) {
        const name = tool.data.tool ?? tool.data.name;
        if (name === undefined) {
          // A tool part whose name is under neither spelling is a shape this
          // does not know, not a tool it chose not to show.
          recordUnparsed(fileName);
          continue;
        }

        const state = toolStateSchema.safeParse(tool.data.state);
        pushToolPair(
          entryBase,
          model,
          {
            id: tool.data.callID ?? tool.data.id ?? "",
            name,
            input: state.success ? (state.data.input ?? {}) : {},
          },
          state.success ? toolResultText(state.data) : "",
        );
        continue;
      }

      const typed = typedShapeSchema.safeParse(part);
      if (typed.success && IGNORED_PART_TYPES.has(typed.data.type)) {
        ignored += 1;
        continue;
      }

      recordUnparsed(fileName);
    }

    return collected.join("\n");
  };

  for (const { fileName, json, parts } of files) {
    const typed = typedShapeSchema.safeParse(json);

    if (typed.success) {
      if (IGNORED_MESSAGE_TYPES.has(typed.data.type)) {
        ignored += 1;
        continue;
      }

      const user = v2UserSchema.safeParse(json);
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

      const assistant = v2AssistantSchema.safeParse(json);
      if (assistant.success) {
        const entryBase = base(assistant.data.time?.created);
        const model = modelName(assistant.data.model);
        lastModel = model ?? lastModel;
        addUsage(assistant.data.cost, assistant.data.tokens);

        // Inline in v2, in sibling files in v1. A message with neither is a
        // shape this does not know: saying nothing about it would render the
        // turn as though the assistant had not spoken.
        const own = assistant.data.content ?? parts;
        if (own === undefined) {
          recordUnparsed(fileName);
          continue;
        }

        renderParts(own, entryBase, model ?? "unknown", fileName, false);
        continue;
      }

      const shell = v2ShellSchema.safeParse(json);
      if (shell.success) {
        const entryBase = base(shell.data.time?.created);
        pushToolPair(
          entryBase,
          lastModel ?? "unknown",
          {
            id: shell.data.callID ?? shell.data.id ?? "",
            name: "shell",
            input: { command: shell.data.command },
          },
          shell.data.output,
        );
        continue;
      }

      recordUnparsed(fileName);
      continue;
    }

    const v1 = v1MessageSchema.safeParse(json);
    if (v1.success) {
      const entryBase = base(v1.data.time?.created);
      recordedCwd = v1.data.path?.cwd ?? recordedCwd;

      if (v1.data.role === "assistant") {
        lastModel = v1.data.modelID ?? lastModel;
        addUsage(v1.data.cost, v1.data.tokens);
        renderParts(parts ?? [], entryBase, v1.data.modelID ?? "unknown", fileName, false);
        continue;
      }

      // A v1 user message keeps its text in parts rather than on the message,
      // so the parts are collected into the one turn the user took.
      const text = renderParts(parts ?? [], entryBase, "unknown", fileName, true);
      if (text === "") continue;

      pending.push((uuid) => ({
        ...entryBase,
        type: "user",
        uuid,
        parentUuid: null,
        message: { role: "user", content: text },
      }));
      continue;
    }

    recordUnparsed(fileName);
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
    cwd: recordedCwd,
    usage: { costUsd, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens },
    parseStats: {
      total: entries.length + ignored + unparsed,
      ignored,
      unparsed,
    },
    unparsedFiles,
  };
};

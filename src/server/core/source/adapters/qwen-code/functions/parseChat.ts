import { z } from "zod";
import type { Conversation } from "../../../../../../lib/conversation-schema/index.ts";
import type { AssistantMessageContent } from "../../../../../../lib/conversation-schema/message/AssistantMessageSchema.ts";
import {
  linkParents,
  syntheticEntryUuid,
} from "../../../../../../lib/conversation-schema/synthetic/entryIdentity.ts";
import type { ExtendedConversation } from "../../../../../../types/conversation.ts";
import type { ParseStats, ReportedUsage } from "../../../models/SourceEntities.ts";
import { QWEN_CODE_SOURCE_ID } from "../../../models/SourceId.ts";

/**
 * Qwen Code writes one JSONL file per session, and its records are a hybrid:
 * the envelope is Claude Code's — `uuid`, `parentUuid`, `sessionId`, `cwd`,
 * `version`, `timestamp`, `type` — while the payload under `message` is
 * Gemini's, a `role`/`parts` pair. It is a Gemini CLI fork, so the second half
 * is inherited; the first half is not, and current Gemini CLI writes neither.
 *
 * Established by running Qwen Code 0.21.6 in `docker/` and reading what it
 * wrote. The fixtures under `fixtures/qwen-home/` are that output verbatim.
 *
 * Only the shapes Lantern renders are modelled. Everything else is *recognised
 * and ignored* rather than dropped silently — a record that is neither rendered
 * nor named is counted unreadable, because a format that moved has to be
 * distinguishable from one that is simply not conversation.
 */

/** A thought part is text the model reasoned with, not text it said. */
const textPartSchema = z.looseObject({
  text: z.string(),
  thought: z.boolean().optional(),
});

const functionCallPartSchema = z.looseObject({
  functionCall: z.looseObject({
    id: z.string().optional(),
    name: z.string(),
    args: z.record(z.string(), z.unknown()).optional(),
  }),
});

const functionResponsePartSchema = z.looseObject({
  functionResponse: z.looseObject({
    id: z.string().optional(),
    name: z.string().optional(),
    response: z.unknown().optional(),
  }),
});

const messageSchema = z.looseObject({
  /** Gemini names the assistant "model"; Lantern's schema calls it assistant. */
  role: z.enum(["user", "model"]),
  parts: z.array(z.unknown()).optional(),
});

/**
 * Gemini's token counts, as Qwen Code records them on an assistant turn.
 *
 * Only a fallback. An assistant record carries the counts for the call that
 * produced it, and not every call produces a message — a turn that only ran
 * internal tools leaves no assistant record at all, so summing these
 * under-reports. In one of the four captured sessions it reports 2050/129
 * against a true 6150/884.
 *
 * `thoughtsTokenCount` is deliberately not added: `totalTokenCount` equals
 * prompt + candidates exactly, so thoughts are already inside the candidate
 * count and adding them would double-count reasoning.
 */
const usageMetadataSchema = z.looseObject({
  promptTokenCount: z.number().optional(),
  candidatesTokenCount: z.number().optional(),
  cachedContentTokenCount: z.number().optional(),
});

/**
 * The telemetry Qwen Code writes for every API call it makes, whether or not
 * the call produced a visible message.
 *
 * This is the accurate total. Summed over a session it reproduces the CLI's own
 * per-session roll-up in `usage_record.jsonl` exactly, for every captured
 * session — which the assistant records alone do not.
 */
const API_RESPONSE_EVENT = "qwen-code.api_response";

const telemetrySchema = z.looseObject({
  uiEvent: z.looseObject({
    "event.name": z.string(),
    input_token_count: z.number().optional(),
    output_token_count: z.number().optional(),
    cached_content_token_count: z.number().optional(),
    model: z.string().optional(),
  }),
});

const recordSchema = z.looseObject({
  type: z.string(),
  subtype: z.string().optional(),
  timestamp: z.string().optional(),
  cwd: z.string().optional(),
  version: z.string().optional(),
  model: z.string().optional(),
  message: z.unknown().optional(),
  usageMetadata: z.unknown().optional(),
  systemPayload: z.unknown().optional(),
});

/**
 * Record types that are not conversation.
 *
 * `system` carries Qwen Code's own telemetry — API timings, tool-call outcomes,
 * attribution snapshots — under `systemPayload`. It duplicates what the
 * assistant and tool_result records already say, and rendering it would show
 * the user their CLI's instrumentation as though it were part of the chat.
 */
const IGNORED_RECORD_TYPES = new Set(["system"]);

export type ParsedChat = {
  readonly entries: readonly ExtendedConversation[];
  readonly messageCount: number;
  readonly modelName: string | null;
  /** The working directory Qwen Code stamps on every record. */
  readonly cwd: string | null;
  readonly usage: ReportedUsage;
  readonly parseStats: ParseStats;
  readonly unparsedLines: readonly number[];
};

/** What a tool reported back, as text. */
const toolResponseText = (response: unknown): string => {
  if (typeof response === "string") return response;
  if (response === undefined || response === null) return "";

  // Only two keys have been observed — `error` on a failed call, `output` on a
  // successful one. Anything else is stringified whole rather than guessed at.
  if (typeof response === "object") {
    const holder: Record<string, unknown> = { ...response };
    for (const key of ["output", "error"]) {
      const value = holder[key];
      if (typeof value === "string" && value !== "") return value;
    }
  }

  return JSON.stringify(response);
};

const isErrorResponse = (response: unknown): boolean =>
  typeof response === "object" &&
  response !== null &&
  "error" in response &&
  (response as Record<string, unknown>)["error"] !== undefined;

export const parseChat = (
  lines: readonly string[],
  options: { readonly sessionKey: string; readonly cwd: string },
): ParsedChat => {
  const unparsedLines: number[] = [];
  let ignored = 0;
  let unparsed = 0;

  let lastModel: string | null = null;
  let recordedCwd: string | null = null;

  // Two independent tallies, because they overlap: an assistant record's own
  // counts repeat the telemetry for the call that produced it. Only one is
  // reported, so nothing is ever counted twice.
  const telemetry = { input: 0, output: 0, cacheRead: 0, calls: 0 };
  const fromMessages = { input: 0, output: 0, cacheRead: 0 };

  const pending: Array<(uuid: string) => Conversation & { uuid: string }> = [];

  const recordUnparsed = (lineNumber: number) => {
    unparsed += 1;
    if (unparsedLines.length < 3) unparsedLines.push(lineNumber);
  };

  const base = (timestamp: string | undefined, cwd: string, version: string | undefined) => ({
    isSidechain: false,
    userType: "external" as const,
    version: version ?? "unknown",
    timestamp: timestamp ?? new Date(0).toISOString(),
    cwd,
    sessionId: options.sessionKey,
  });

  type EntryBase = ReturnType<typeof base>;

  const pushUserText = (entryBase: EntryBase, text: string) => {
    pending.push((uuid) => ({
      ...entryBase,
      type: "user",
      uuid,
      parentUuid: null,
      message: { role: "user", content: text },
    }));
  };

  const pushAssistantBlock = (
    entryBase: EntryBase,
    model: string,
    content: AssistantMessageContent[],
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
        content,
        stop_reason: null,
        stop_sequence: null,
      },
    }));
  };

  const pushToolResult = (
    entryBase: EntryBase,
    toolUseId: string,
    text: string,
    error: boolean,
  ) => {
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
            tool_use_id: toolUseId === "" ? uuid : toolUseId,
            content: text,
            is_error: error,
          },
        ],
      },
    }));
  };

  /**
   * Renders one record's parts.
   *
   * A record fans out into as many entries as it has parts: one assistant turn
   * routinely carries its reasoning, its reply and a tool call together, and
   * Lantern renders each as its own block.
   */
  const renderParts = (
    parts: readonly unknown[],
    entryBase: EntryBase,
    role: "user" | "model",
    model: string,
    lineNumber: number,
  ) => {
    for (const part of parts) {
      const call = functionCallPartSchema.safeParse(part);
      if (call.success) {
        pushAssistantBlock(entryBase, model, [
          {
            type: "tool_use",
            id: call.data.functionCall.id ?? "",
            name: call.data.functionCall.name,
            input: call.data.functionCall.args ?? {},
          },
        ]);
        continue;
      }

      const response = functionResponsePartSchema.safeParse(part);
      if (response.success) {
        pushToolResult(
          entryBase,
          response.data.functionResponse.id ?? "",
          toolResponseText(response.data.functionResponse.response),
          isErrorResponse(response.data.functionResponse.response),
        );
        continue;
      }

      const text = textPartSchema.safeParse(part);
      if (text.success) {
        if (text.data.text === "") {
          ignored += 1;
          continue;
        }

        if (role === "user") {
          pushUserText(entryBase, text.data.text);
          continue;
        }

        pushAssistantBlock(
          entryBase,
          model,
          text.data.thought === true
            ? [{ type: "thinking", thinking: text.data.text }]
            : [{ type: "text", text: text.data.text }],
        );
        continue;
      }

      recordUnparsed(lineNumber);
    }
  };

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (line.trim() === "") continue;

    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      recordUnparsed(lineNumber);
      continue;
    }

    const record = recordSchema.safeParse(json);
    if (!record.success) {
      recordUnparsed(lineNumber);
      continue;
    }

    if (IGNORED_RECORD_TYPES.has(record.data.type)) {
      ignored += 1;

      // Not rendered, but not worthless: this is where the true token counts
      // are. Harvested before the record is dropped.
      const event = telemetrySchema.safeParse(record.data.systemPayload);
      if (event.success && event.data.uiEvent["event.name"] === API_RESPONSE_EVENT) {
        telemetry.calls += 1;
        telemetry.input += event.data.uiEvent.input_token_count ?? 0;
        telemetry.output += event.data.uiEvent.output_token_count ?? 0;
        telemetry.cacheRead += event.data.uiEvent.cached_content_token_count ?? 0;
        lastModel = event.data.uiEvent.model ?? lastModel;
      }

      continue;
    }

    recordedCwd = record.data.cwd ?? recordedCwd;
    lastModel = record.data.model ?? lastModel;

    const usage = usageMetadataSchema.safeParse(record.data.usageMetadata);
    if (usage.success) {
      fromMessages.input += usage.data.promptTokenCount ?? 0;
      fromMessages.output += usage.data.candidatesTokenCount ?? 0;
      fromMessages.cacheRead += usage.data.cachedContentTokenCount ?? 0;
    }

    const message = messageSchema.safeParse(record.data.message);
    if (!message.success) {
      // A record that is neither telemetry nor a message is a shape this does
      // not know. Counting it is the whole point: a turn that quietly went
      // missing looks exactly like a session that had fewer turns.
      recordUnparsed(lineNumber);
      continue;
    }

    renderParts(
      message.data.parts ?? [],
      base(record.data.timestamp, record.data.cwd ?? options.cwd, record.data.version),
      message.data.role,
      record.data.model ?? lastModel ?? "unknown",
      lineNumber,
    );
  }

  const entries = linkParents(
    pending.map((build, index) =>
      // Qwen Code writes real uuids, but one record becomes several entries, so
      // they cannot be reused as-is. Synthesised ids stay stable across
      // re-reads, which is what search links and deep links depend on.
      build(syntheticEntryUuid(QWEN_CODE_SOURCE_ID, options.sessionKey, index)),
    ),
  );

  // Telemetry covers every API call; the assistant records only cover the ones
  // that produced a message. Where there is telemetry it is the whole truth, so
  // the message tally is used only when telemetry is switched off entirely.
  const counted = telemetry.calls > 0 ? telemetry : fromMessages;

  return {
    entries,
    messageCount: entries.length,
    modelName: lastModel,
    cwd: recordedCwd,
    usage: {
      // Qwen Code counts tokens but never prices them — it is pointed at
      // whatever provider the user configured, and Lantern has no table for it.
      costUsd: null,
      inputTokens: counted.input,
      outputTokens: counted.output,
      cacheReadTokens: counted.cacheRead,
      cacheCreationTokens: 0,
      modelName: lastModel,
    },
    parseStats: {
      total: entries.length + ignored + unparsed,
      ignored,
      unparsed,
    },
    unparsedLines,
  };
};

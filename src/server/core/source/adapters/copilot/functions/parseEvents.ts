import { z } from "zod";
import type { Conversation } from "../../../../../../lib/conversation-schema/index.ts";
import type { AssistantMessageContent } from "../../../../../../lib/conversation-schema/message/AssistantMessageSchema.ts";
import {
  linkParents,
  syntheticEntryUuid,
} from "../../../../../../lib/conversation-schema/synthetic/entryIdentity.ts";
import type { ExtendedConversation } from "../../../../../../types/conversation.ts";
import type { ParseStats, ReportedUsage } from "../../../models/SourceEntities.ts";
import { COPILOT_SOURCE_ID } from "../../../models/SourceId.ts";

/**
 * Copilot CLI writes one JSONL event log per session, at
 * `session-state/<uuid>/events.jsonl`.
 *
 * Every line is `{type, data, id, timestamp, parentId}` — a typed event stream
 * rather than a list of messages, so a turn is assembled from several events:
 * the assistant's text and its tool requests arrive on one `assistant.message`,
 * and each tool's outcome arrives later on its own `tool.execution_complete`,
 * matched by `toolCallId`.
 *
 * Established by running Copilot CLI 1.0.78 in `docker/` and reading what it
 * wrote. The fixtures under `fixtures/copilot-home/` are that output verbatim.
 *
 * Only the shapes Lantern renders are modelled. Everything else is *recognised
 * and ignored* rather than dropped silently — an event that is neither rendered
 * nor named is counted unreadable, because a format that moved has to be
 * distinguishable from one that is simply not conversation.
 */

const sessionStartSchema = z.looseObject({
  sessionId: z.string().optional(),
  copilotVersion: z.string().optional(),
  startTime: z.string().optional(),
  context: z
    .looseObject({
      cwd: z.string().optional(),
      gitRoot: z.string().optional(),
      branch: z.string().optional(),
    })
    .optional(),
});

const userMessageSchema = z.looseObject({
  /**
   * What the person typed. `transformedContent` sits beside it holding the same
   * text wrapped in an injected `<current_datetime>` block and a
   * `<system_reminder>`; rendering that would make every session's title start
   * with a timestamp, which is the mistake Codex's `<environment_context>`
   * already taught once.
   */
  content: z.string(),
});

const toolRequestSchema = z.looseObject({
  toolCallId: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

const assistantMessageSchema = z.looseObject({
  model: z.string().optional(),
  content: z.string().optional(),
  /** The model's own reasoning, kept apart from what it actually said. */
  reasoningText: z.string().optional(),
  toolRequests: z.array(toolRequestSchema).optional(),
});

const toolCompleteSchema = z.looseObject({
  toolCallId: z.string(),
  success: z.boolean().optional(),
  result: z.looseObject({ content: z.string().optional() }).optional(),
  error: z.looseObject({ message: z.string().optional() }).optional(),
});

const modelChangeSchema = z.looseObject({ newModel: z.string().optional() });

const usageSchema = z.looseObject({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cacheReadTokens: z.number().optional(),
  cacheWriteTokens: z.number().optional(),
});

/**
 * The per-model roll-up Copilot writes when a session ends.
 *
 * The only place token counts appear in the log at all, and it is absent from a
 * session that was killed rather than closed — which is why usage is optional
 * rather than assumed.
 */
const shutdownSchema = z.looseObject({
  modelMetrics: z.record(z.string(), z.looseObject({ usage: usageSchema.optional() })).optional(),
});

const eventSchema = z.looseObject({
  type: z.string(),
  timestamp: z.string().optional(),
  data: z.unknown().optional(),
});

/**
 * Events that are not conversation.
 *
 * `system.message` is the CLI's own system prompt — thousands of words of
 * instructions nobody typed, which would otherwise become the session's first
 * message and its title. The turn markers carry no content of their own; the
 * tool start is the same call the assistant message already announced.
 */
const IGNORED_EVENTS = new Set([
  "system.message",
  "assistant.turn_start",
  "assistant.turn_end",
  "tool.execution_start",
]);

export type CopilotMeta = {
  readonly sessionId: string | null;
  readonly cwd: string | null;
  readonly gitRoot: string | null;
  readonly cliVersion: string;
  readonly startTime: string | null;
};

export type ParsedEvents = {
  readonly meta: CopilotMeta;
  readonly entries: readonly ExtendedConversation[];
  readonly messageCount: number;
  readonly modelName: string | null;
  readonly usage: ReportedUsage;
  readonly parseStats: ParseStats;
  readonly unparsedLines: readonly number[];
};

const EMPTY_META: CopilotMeta = {
  sessionId: null,
  cwd: null,
  gitRoot: null,
  cliVersion: "unknown",
  startTime: null,
};

/**
 * Reads just the session's identity from the head of its log.
 *
 * `session.start` is always the first line and is a few hundred bytes, so
 * grouping thousands of sessions by workspace never has to parse a whole
 * transcript.
 */
export const parseMeta = (head: string): CopilotMeta => {
  for (const line of head.split("\n")) {
    if (line.trim() === "") continue;

    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      // A truncated final line is normal while the CLI is still writing.
      continue;
    }

    const event = eventSchema.safeParse(json);
    if (!event.success || event.data.type !== "session.start") continue;

    const start = sessionStartSchema.safeParse(event.data.data);
    if (!start.success) continue;

    return {
      sessionId: start.data.sessionId ?? null,
      cwd: start.data.context?.cwd ?? null,
      gitRoot: start.data.context?.gitRoot ?? null,
      cliVersion: start.data.copilotVersion ?? "unknown",
      startTime: start.data.startTime ?? null,
    };
  }

  return EMPTY_META;
};

export const parseEvents = (content: string, sessionKey: string): ParsedEvents => {
  const unparsedLines: number[] = [];
  let ignored = 0;
  let unparsed = 0;

  let meta = EMPTY_META;
  let lastModel: string | null = null;

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;

  const pending: Array<(uuid: string) => Conversation & { uuid: string }> = [];

  /**
   * Where each tool call's result should be written once it arrives.
   *
   * A tool's outcome is a separate event that can land several events after the
   * call, so the result entry is reserved in order and filled in later — which
   * keeps the call and its result adjacent in the rendered conversation.
   */
  const awaitingResult = new Map<string, number>();
  const resolvedResults = new Map<number, { text: string; error: boolean }>();

  const recordUnparsed = (lineNumber: number) => {
    unparsed += 1;
    if (unparsedLines.length < 3) unparsedLines.push(lineNumber);
  };

  const base = (timestamp: string | undefined) => ({
    isSidechain: false,
    userType: "external" as const,
    version: meta.cliVersion,
    timestamp: timestamp ?? new Date(0).toISOString(),
    cwd: meta.cwd ?? "",
    sessionId: sessionKey,
  });

  type EntryBase = ReturnType<typeof base>;

  const pushAssistant = (
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

  for (const [index, line] of content.split("\n").entries()) {
    const lineNumber = index + 1;
    if (line.trim() === "") continue;

    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      recordUnparsed(lineNumber);
      continue;
    }

    const event = eventSchema.safeParse(json);
    if (!event.success) {
      recordUnparsed(lineNumber);
      continue;
    }

    const entryBase = base(event.data.timestamp);

    switch (event.data.type) {
      case "session.start": {
        const start = sessionStartSchema.safeParse(event.data.data);
        if (!start.success) {
          recordUnparsed(lineNumber);
          break;
        }
        meta = {
          sessionId: start.data.sessionId ?? null,
          cwd: start.data.context?.cwd ?? null,
          gitRoot: start.data.context?.gitRoot ?? null,
          cliVersion: start.data.copilotVersion ?? "unknown",
          startTime: start.data.startTime ?? null,
        };
        ignored += 1;
        break;
      }

      case "user.message": {
        const user = userMessageSchema.safeParse(event.data.data);
        if (!user.success) {
          recordUnparsed(lineNumber);
          break;
        }
        pending.push((uuid) => ({
          ...base(event.data.timestamp),
          type: "user",
          uuid,
          parentUuid: null,
          message: { role: "user", content: user.data.content },
        }));
        break;
      }

      case "assistant.message": {
        const assistant = assistantMessageSchema.safeParse(event.data.data);
        if (!assistant.success) {
          recordUnparsed(lineNumber);
          break;
        }

        lastModel = assistant.data.model ?? lastModel;
        const model = lastModel ?? "unknown";

        if (assistant.data.reasoningText !== undefined && assistant.data.reasoningText !== "") {
          pushAssistant(entryBase, model, [
            { type: "thinking", thinking: assistant.data.reasoningText },
          ]);
        }

        if (assistant.data.content !== undefined && assistant.data.content !== "") {
          pushAssistant(entryBase, model, [{ type: "text", text: assistant.data.content }]);
        }

        for (const request of assistant.data.toolRequests ?? []) {
          pushAssistant(entryBase, model, [
            {
              type: "tool_use",
              id: request.toolCallId,
              name: request.name,
              input: request.arguments ?? {},
            },
          ]);

          // Reserve the slot the result will fill, so a call and its outcome
          // stay next to each other however far apart they were logged.
          const slot = pending.length;
          awaitingResult.set(request.toolCallId, slot);
          const toolCallId = request.toolCallId;
          pending.push((uuid) => {
            const resolved = resolvedResults.get(slot);
            return {
              ...entryBase,
              type: "user",
              uuid,
              parentUuid: null,
              message: {
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: toolCallId,
                    content: resolved?.text ?? "",
                    is_error: resolved?.error ?? false,
                  },
                ],
              },
            };
          });
        }
        break;
      }

      case "tool.execution_complete": {
        const complete = toolCompleteSchema.safeParse(event.data.data);
        if (!complete.success) {
          recordUnparsed(lineNumber);
          break;
        }

        const slot = awaitingResult.get(complete.data.toolCallId);
        if (slot === undefined) {
          // A result for a call this log never announced. Not conversation
          // that can be threaded, and not a shape surprise either.
          ignored += 1;
          break;
        }

        const failed = complete.data.success === false;
        resolvedResults.set(slot, {
          text: failed
            ? (complete.data.error?.message ?? "")
            : (complete.data.result?.content ?? ""),
          error: failed,
        });
        ignored += 1;
        break;
      }

      case "session.model_change": {
        const change = modelChangeSchema.safeParse(event.data.data);
        lastModel = (change.success ? change.data.newModel : undefined) ?? lastModel;
        ignored += 1;
        break;
      }

      case "session.shutdown": {
        const shutdown = shutdownSchema.safeParse(event.data.data);
        if (shutdown.success) {
          for (const [model, metrics] of Object.entries(shutdown.data.modelMetrics ?? {})) {
            lastModel = lastModel ?? model;
            const usage = usageSchema.safeParse(metrics.usage);
            if (!usage.success) continue;

            inputTokens += usage.data.inputTokens ?? 0;
            outputTokens += usage.data.outputTokens ?? 0;
            cacheReadTokens += usage.data.cacheReadTokens ?? 0;
            cacheCreationTokens += usage.data.cacheWriteTokens ?? 0;
          }
        }
        ignored += 1;
        break;
      }

      default: {
        if (IGNORED_EVENTS.has(event.data.type)) {
          ignored += 1;
          break;
        }
        recordUnparsed(lineNumber);
      }
    }
  }

  const entries = linkParents(
    pending.map((build, index) => build(syntheticEntryUuid(COPILOT_SOURCE_ID, sessionKey, index))),
  );

  return {
    meta,
    entries,
    messageCount: entries.length,
    modelName: lastModel,
    usage: {
      // Copilot bills in premium requests, not dollars, and under BYOK the user
      // pays their own provider. Neither is a figure Lantern can turn into a
      // cost, so none is claimed.
      costUsd: null,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
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

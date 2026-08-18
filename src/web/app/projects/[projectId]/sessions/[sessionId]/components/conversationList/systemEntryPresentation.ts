import type { Conversation } from "@/lib/conversation-schema";

type SystemEntry = Extract<Conversation, { type: "system" }>;

/** Which heading a system entry gets. Kept as a closed set so the component
 * can map each one to a static, extractable translation. */
export type SystemEntryLabel =
  | "recap"
  | "notice"
  | "compacted"
  | "api_error"
  | "command_output"
  | "turn_duration"
  | "stop_hooks"
  | "generic";

export type SystemEntryPresentation = {
  label: SystemEntryLabel;
  /** What to show once the row is opened. Empty when the label says it all. */
  body: string;
  tone: "muted" | "error";
  /** Prose the person actually saw is opened for them; plumbing stays folded. */
  defaultOpen: boolean;
};

const formatSeconds = (milliseconds: number): string => `${(milliseconds / 1000).toFixed(1)}s`;

const formatApiError = (conversation: Extract<SystemEntry, { subtype: "api_error" }>): string => {
  const lines: string[] = [];
  const error = conversation.error;

  const message =
    error.error?.error?.message ??
    error.error?.message ??
    (error.error !== undefined ? JSON.stringify(error.error, null, 2) : undefined);

  if (message !== undefined && message !== "") {
    lines.push(message);
  }

  if (error.status !== undefined) {
    lines.push(`HTTP ${error.status}`);
  }

  if (conversation.retryAttempt !== undefined && conversation.maxRetries !== undefined) {
    const retryIn =
      conversation.retryInMs !== undefined ? ` in ${formatSeconds(conversation.retryInMs)}` : "";
    lines.push(`Retry ${conversation.retryAttempt}/${conversation.maxRetries}${retryIn}`);
  }

  return lines.join("\n");
};

const formatStopHookSummary = (
  conversation: Extract<SystemEntry, { subtype: "stop_hook_summary" }>,
): string => {
  const lines: string[] = [`Stop reason: ${conversation.stopReason}`];

  if (conversation.hookInfos.length > 0) {
    lines.push(`Commands: ${conversation.hookInfos.map((hook) => hook.command).join(", ")}`);
  }

  if (conversation.preventedContinuation) {
    lines.push("Prevented continuation");
  }

  if (conversation.hookErrors.length > 0) {
    lines.push(`Errors: ${JSON.stringify(conversation.hookErrors, null, 2)}`);
  }

  return lines.join("\n");
};

/**
 * Turns a system entry into something worth reading.
 *
 * The old rendering printed the raw subtype and every field beside it, so a
 * recap the person had already read on screen arrived as `[away_summary]`
 * followed by a wall of ids. A system entry is not one thing: some are notices
 * addressed to the reader, some are the CLI talking to itself. Name each one
 * and show only the part with something to say.
 */
export const describeSystemEntry = (conversation: SystemEntry): SystemEntryPresentation => {
  switch (conversation.subtype) {
    case "away_summary":
      return {
        label: "recap",
        body: conversation.content,
        tone: "muted",
        defaultOpen: true,
      };

    case "informational":
      return {
        label: "notice",
        body: conversation.content,
        tone: conversation.level === "error" ? "error" : "muted",
        defaultOpen: true,
      };

    case "compact_boundary":
      return {
        label: "compacted",
        body: conversation.content,
        tone: "muted",
        defaultOpen: true,
      };

    case "api_error":
      return {
        label: "api_error",
        body: formatApiError(conversation),
        tone: "error",
        defaultOpen: true,
      };

    case "local_command":
      return {
        label: "command_output",
        body: conversation.content,
        tone: "muted",
        defaultOpen: false,
      };

    case "turn_duration":
      return {
        label: "turn_duration",
        body: formatSeconds(conversation.durationMs),
        tone: "muted",
        defaultOpen: false,
      };

    case "stop_hook_summary":
      return {
        label: "stop_hooks",
        body: formatStopHookSummary(conversation),
        tone: "muted",
        defaultOpen: false,
      };

    case undefined:
      return {
        label: "generic",
        body: conversation.content,
        tone: "muted",
        defaultOpen: false,
      };

    default:
      conversation satisfies never;
      return { label: "generic", body: "", tone: "muted", defaultOpen: false };
  }
};

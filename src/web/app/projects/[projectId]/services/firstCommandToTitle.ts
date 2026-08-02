import type { ParsedUserMessage } from "@/lib/claude-code/parseUserMessage";

const stripLocalCommandCaveat = (text: string) => {
  return text.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "").trim();
};

/**
 * Resolves a session's display title with priority:
 * 1. customTitle (user-renamed via /rename)
 * 2. firstUserMessage-derived title
 * 3. fallback string (e.g. sessionId)
 */
export const resolveSessionTitle = (
  customTitle: string | null,
  firstUserMessage: ParsedUserMessage | null,
  fallback: string,
): string =>
  customTitle ?? (firstUserMessage ? firstUserMessageToTitle(firstUserMessage) : fallback);

/**
 * Collapses whitespace and clips a title so list rows stay scannable.
 * Session titles fall back to the raw first user message, which can be a whole
 * paragraph of pasted context.
 */
export const toConciseTitle = (title: string, maxLength = 100): string => {
  const collapsed = title.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return `${collapsed.slice(0, maxLength - 1).trimEnd()}…`;
};

export const firstUserMessageToTitle = (firstCommand: ParsedUserMessage) => {
  switch (firstCommand.kind) {
    case "command":
      if (firstCommand.commandArgs === undefined) {
        return firstCommand.commandName;
      }
      return `${firstCommand.commandName} ${firstCommand.commandArgs}`;
    case "local-command":
      return stripLocalCommandCaveat(firstCommand.stdout);
    case "text":
      return stripLocalCommandCaveat(firstCommand.content);
    default:
      firstCommand satisfies never;
      throw new Error("Invalid first command");
  }
};

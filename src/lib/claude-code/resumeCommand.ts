import { shellEscape } from "../shell/shellEscape.ts";

/** Default name of the Claude Code binary, when none was configured. */
export const CLAUDE_EXECUTABLE_NAME = "claude";

/**
 * The command that picks a conversation back up.
 *
 * Written out rather than run, so it has to survive being pasted into any
 * shell: the executable path is only quoted when it needs to be, and the
 * session id always is.
 */
export const buildResumeCommand = (sessionId: string, executable?: string): string => {
  const binary =
    executable === undefined || executable === "" ? CLAUDE_EXECUTABLE_NAME : executable;
  const quotedBinary = /^[\w./-]+$/.test(binary) ? binary : shellEscape(binary);

  return `${quotedBinary} --resume ${shellEscape(sessionId)}`;
};

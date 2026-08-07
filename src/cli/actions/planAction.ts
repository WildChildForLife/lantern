import { buildResumeCommand, CLAUDE_EXECUTABLE_NAME } from "../../lib/claude-code/resumeCommand.ts";
import type { ResumeAction } from "../config/cliConfig.ts";
import { applyTerminalTemplate, buildEmulatorLaunch } from "./terminalEmulator.ts";

export type ActionRequest = {
  action: ResumeAction;
  sessionId: string;
  /**
   * Directory the conversation ran in, or null when Lantern does not know it.
   *
   * Not optional detail: `claude --resume` looks the session up under the
   * directory it is run from, so resuming anywhere else reports the
   * conversation as missing.
   */
  cwd: string | null;
  executable: string | undefined;
  terminalCommand: string | undefined;
  /** Whether the CLI that wrote this conversation can be driven at all. */
  interactive: boolean;
  /** Terminal binary found on this machine, or null if none was. */
  emulator: string | null;
  platform: NodeJS.Platform;
  /** Whether Lantern is running inside WSL, which changes how a window opens. */
  wsl?: boolean | undefined;
};

export type ActionPlan =
  | { kind: "copy"; text: string; label: string }
  | { kind: "print"; text: string; cwd: string }
  | { kind: "handoff"; binary: string; args: string[]; cwd: string }
  | { kind: "spawn"; binary: string; args: string[]; cwd: string }
  | { kind: "refused"; reason: string };

/**
 * Works out what a keypress on a conversation should actually do.
 *
 * Kept apart from doing it so the awkward cases — a read-only source, a
 * machine with no terminal emulator, a session id with a quote in it — are
 * settled in tests instead of by spawning processes.
 */
export const planAction = (request: ActionRequest): ActionPlan => {
  const command = buildResumeCommand(request.sessionId, request.executable);

  if (request.action === "copy-id") {
    return { kind: "copy", text: request.sessionId, label: "conversation id" };
  }

  // Only Claude Code can be driven; the other CLIs are read here, not run.
  if (!request.interactive) {
    return { kind: "refused", reason: "this CLI is read-only in Lantern" };
  }

  // Running somewhere else does not resume in the wrong place, it fails to
  // resume at all — Claude Code finds a session by the directory it is in.
  if (request.cwd === null) {
    return {
      kind: "refused",
      reason: "Lantern does not know which directory this conversation ran in",
    };
  }

  const cwd = request.cwd;

  if (request.action === "print") {
    return { kind: "print", text: command, cwd };
  }

  if (request.action === "resume-here") {
    return {
      kind: "handoff",
      // argv, not a shell line: nothing here needs quoting, and quoting it
      // would make the id part of the argument.
      binary:
        request.executable === undefined || request.executable === ""
          ? CLAUDE_EXECUTABLE_NAME
          : request.executable,
      args: ["--resume", request.sessionId],
      cwd,
    };
  }

  const params = { command, cwd };

  if (request.terminalCommand !== undefined && request.terminalCommand !== "") {
    const launch = applyTerminalTemplate(request.terminalCommand, params, {
      platform: request.platform,
    });
    return { kind: "spawn", binary: launch.binary, args: launch.args, cwd };
  }

  const launch =
    request.emulator === null
      ? null
      : buildEmulatorLaunch(request.emulator, params, { wsl: request.wsl });
  if (launch === null) {
    return { kind: "print", text: command, cwd };
  }

  return { kind: "spawn", binary: launch.binary, args: launch.args, cwd };
};

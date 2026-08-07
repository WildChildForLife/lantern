import { describe, expect, it } from "vitest";
import { planAction } from "./planAction.ts";

const base = {
  sessionId: "abc-123",
  cwd: "/home/dev/lantern",
  executable: undefined,
  terminalCommand: undefined,
  interactive: true,
  emulator: "kitty",
  platform: "linux",
} as const;

describe("planAction", () => {
  it("copies the bare conversation id", () => {
    expect(planAction({ ...base, action: "copy-id" })).toStrictEqual({
      kind: "copy",
      text: "abc-123",
      label: "conversation id",
    });
  });

  it("prints a command that can be pasted straight into a shell", () => {
    const plan = planAction({ ...base, action: "print" });

    expect(plan).toStrictEqual({
      kind: "print",
      text: `claude --resume "abc-123"`,
      cwd: "/home/dev/lantern",
    });
  });

  it("uses the configured executable in the printed command", () => {
    const plan = planAction({ ...base, action: "print", executable: "/opt/claude" });

    expect(plan).toStrictEqual({
      kind: "print",
      text: `/opt/claude --resume "abc-123"`,
      cwd: "/home/dev/lantern",
    });
  });

  it("hands the terminal over when resuming in place", () => {
    expect(planAction({ ...base, action: "resume-here" })).toStrictEqual({
      kind: "handoff",
      binary: "claude",
      args: ["--resume", "abc-123"],
      cwd: "/home/dev/lantern",
    });
  });

  /** Passed as argv, so the id must not be shell-quoted here. */
  it("does not quote the id when handing over, since no shell is involved", () => {
    const plan = planAction({ ...base, action: "resume-here", sessionId: 'a"b' });

    expect(plan).toStrictEqual({
      kind: "handoff",
      binary: "claude",
      args: ["--resume", 'a"b'],
      cwd: "/home/dev/lantern",
    });
  });

  it("opens a detected emulator for a new window", () => {
    const plan = planAction({ ...base, action: "new-window" });

    expect(plan.kind).toBe("spawn");
  });

  it("prefers the user's own terminal command over detection", () => {
    const plan = planAction({
      ...base,
      action: "new-window",
      terminalCommand: "my-term -e {{command}}",
    });

    expect(plan).toMatchObject({ kind: "spawn", binary: "sh" });
  });

  /** Guessing at flags for an unknown emulator would open the wrong thing. */
  it("falls back to printing when no emulator was found", () => {
    const plan = planAction({ ...base, action: "new-window", emulator: null });

    expect(plan).toMatchObject({ kind: "print" });
  });

  it("refuses to resume a conversation from a read-only CLI", () => {
    for (const action of ["resume-here", "new-window", "print"] as const) {
      expect(planAction({ ...base, action, interactive: false })).toMatchObject({
        kind: "refused",
      });
    }
  });

  /** Copying an id is just text; it works whichever CLI wrote the conversation. */
  it("still copies the id of a read-only conversation", () => {
    expect(planAction({ ...base, action: "copy-id", interactive: false }).kind).toBe("copy");
  });

  /**
   * `claude --resume` finds a session by the directory it runs in, so without
   * one there is nothing sensible to run — and guessing produces "conversation
   * not found" rather than an honest refusal.
   */
  it("refuses to resume a conversation whose directory is unknown", () => {
    for (const action of ["resume-here", "new-window", "print"] as const) {
      expect(planAction({ ...base, action, cwd: null })).toMatchObject({ kind: "refused" });
    }
  });

  it("still copies the id when the directory is unknown", () => {
    expect(planAction({ ...base, action: "copy-id", cwd: null }).kind).toBe("copy");
  });
});

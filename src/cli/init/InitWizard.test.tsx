import { render } from "ink-testing-library";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type * as DetectModuleNamespace from "./detect.ts";
import type { Detection } from "./detect.ts";

type DetectModule = typeof DetectModuleNamespace;
import { InitWizard } from "./InitWizard.tsx";

// The claude-dir step checks the path really holds a `projects` directory;
// these tests are about the wizard's flow, not the filesystem.
vi.mock("./detect.ts", async (importOriginal) => {
  const original = await importOriginal<DetectModule>();

  return { ...original, looksLikeClaudeDirectory: () => Promise.resolve(true) };
});

const ENTER = "\r";
const ARROW_DOWN = `${String.fromCodePoint(0x1b)}[B`;

const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 20));

const press = async (stdin: { write: (input: string) => void }, input: string) => {
  await act(async () => {
    stdin.write(input);
    await nextFrame();
  });
};

const detection: Detection = {
  sources: [
    {
      id: "claude-code",
      displayName: "Claude Code",
      rootPath: "/home/dev/.claude",
      usable: true,
    },
    { id: "codex", displayName: "Codex CLI", rootPath: null, usable: false },
  ],
  claudeDirectory: "/home/dev/.claude",
  executable: "/usr/local/bin/claude",
  terminalAvailable: true,
  passwordSet: false,
};

const setup = (overrides?: Partial<Detection>) => {
  const onDone = vi.fn();
  const result = render(
    <InitWizard detection={{ ...detection, ...overrides }} initial={{}} onDone={onDone} />,
  );

  return { ...result, onDone };
};

/** Enter through every question, taking the detected answer each time. */
const acceptAll = async (stdin: { write: (input: string) => void }, times: number) => {
  for (let index = 0; index < times; index += 1) {
    await press(stdin, ENTER);
  }
};

describe("InitWizard", () => {
  it("starts by asking which agent CLIs to read, with the detected ones ticked", async () => {
    const { lastFrame } = setup();
    await nextFrame();

    expect(lastFrame()).toContain("Which agent CLIs should Lantern read?");
    expect(lastFrame()).toContain("Claude Code");
    expect(lastFrame()).toContain("◉ Claude Code");
    expect(lastFrame()).toContain("◯ Codex CLI");
  });

  it("says where it found each CLI, and where it did not", async () => {
    const { lastFrame } = setup();
    await nextFrame();

    expect(lastFrame()).toContain("/home/dev/.claude");
    expect(lastFrame()).toContain("not found on this machine");
  });

  it("takes the detected answer for every question in turn", async () => {
    const { stdin, onDone } = setup();
    await nextFrame();
    await acceptAll(stdin, 7);

    expect(onDone).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: ["claude-code"],
        claudeDir: "/home/dev/.claude",
        executable: "/usr/local/bin/claude",
        port: 3000,
        hostname: "127.0.0.1",
        terminalDisabled: false,
        runSync: true,
      }),
    );
  });

  it("offers the executable it found", async () => {
    const { stdin, lastFrame } = setup();
    await nextFrame();
    await acceptAll(stdin, 2);

    expect(lastFrame()).toContain("Where is the claude executable?");
    expect(lastFrame()).toContain("Using /usr/local/bin/claude");
  });

  it("says so when there is no claude on PATH", async () => {
    const { stdin, lastFrame } = setup({ executable: null });
    await nextFrame();
    await acceptAll(stdin, 2);

    expect(lastFrame()).toContain("Not found on PATH");
  });

  it("refuses a port outside the valid range", async () => {
    const { stdin, lastFrame } = setup();
    await nextFrame();
    await acceptAll(stdin, 3);
    await press(stdin, "70000");
    await press(stdin, ENTER);

    expect(lastFrame()).toContain("Ports run from 1 to 65535.");
  });

  /** The security warning is the whole point of asking about the bind address. */
  it("warns before binding somewhere the network can reach", async () => {
    const { stdin, lastFrame } = setup();
    await nextFrame();
    await acceptAll(stdin, 4);
    await press(stdin, ARROW_DOWN);
    await press(stdin, ARROW_DOWN);
    await press(stdin, ARROW_DOWN);
    await press(stdin, ENTER);

    expect(lastFrame()).toContain("without a password hands a shell");
    expect(lastFrame()).toContain("LANTERN_PASSWORD");
  });

  it("says nothing about a password for a loopback bind", async () => {
    const { stdin, lastFrame } = setup();
    await nextFrame();
    await acceptAll(stdin, 5);

    expect(lastFrame()).toContain("Enable the in-app terminal?");
  });

  it("defaults the in-app terminal off where its binary is missing", async () => {
    const { stdin, lastFrame } = setup({ terminalAvailable: false });
    await nextFrame();
    await acceptAll(stdin, 5);

    expect(lastFrame()).toContain("No prebuilt PTY binary for this platform");
  });

  /** It is switched on the board, so the wizard must not ask about it. */
  it("never asks what Enter should do", async () => {
    const { stdin, lastFrame } = setup();
    await nextFrame();
    await acceptAll(stdin, 6);

    expect(lastFrame()).toContain("Read your conversation logs now?");
  });

  it("never leaves the user reading nothing at all", async () => {
    const { stdin, onDone } = setup();
    await nextFrame();
    await press(stdin, " ");
    await acceptAll(stdin, 7);

    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ sources: ["claude-code"] }));
  });

  /**
   * The regression these exist for: the wizard used to render the right thing
   * and then throw the answer away, which a test asserting on the frame cannot
   * see.
   */
  it("backs out to the bind address when the warning is declined", async () => {
    const { stdin, lastFrame, onDone } = setup();
    await nextFrame();
    await acceptAll(stdin, 4);
    await press(stdin, ARROW_DOWN);
    await press(stdin, ARROW_DOWN);
    await press(stdin, ARROW_DOWN);
    await press(stdin, ENTER);
    await press(stdin, "n");

    expect(lastFrame()).toContain("Which address should it bind to?");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("defaults the warning to backing out when no password is set", async () => {
    const { stdin, lastFrame } = setup();
    await nextFrame();
    await acceptAll(stdin, 4);
    await press(stdin, ARROW_DOWN);
    await press(stdin, ARROW_DOWN);
    await press(stdin, ARROW_DOWN);
    await press(stdin, ENTER);
    // Enter takes the highlighted answer, which must be the safe one.
    await press(stdin, ENTER);

    expect(lastFrame()).toContain("Which address should it bind to?");
  });

  it("says the port is protected when a password is already in the environment", async () => {
    const { stdin, lastFrame } = setup({ passwordSet: true });
    await nextFrame();
    await acceptAll(stdin, 4);
    await press(stdin, ARROW_DOWN);
    await press(stdin, ARROW_DOWN);
    await press(stdin, ARROW_DOWN);
    await press(stdin, ENTER);

    expect(lastFrame()).toContain("is password-protected");
  });

  /**
   * The claim and the default both hang off one flag, so the flag is what has to
   * be right — `detect.ts` now answers it with the same rule the server resolves
   * options by, where an exported-but-empty variable is not a password. This
   * pins the consequence: with no password, the wizard neither says the bind is
   * protected nor defaults the answer to yes.
   */
  it("does not claim protection, or default to yes, without a password", async () => {
    const { stdin, lastFrame } = setup({ passwordSet: false });
    await nextFrame();
    await acceptAll(stdin, 4);
    await press(stdin, ARROW_DOWN);
    await press(stdin, ARROW_DOWN);
    await press(stdin, ARROW_DOWN);
    await press(stdin, ENTER);

    expect(lastFrame()).not.toContain("is password-protected");

    // Enter takes the highlighted answer, and the highlighted answer is "no".
    await press(stdin, ENTER);

    expect(lastFrame()).toContain("Which address should it bind to?");
  });

  it("keeps a bind address the user insisted on", async () => {
    const { stdin, onDone } = setup();
    await nextFrame();
    await acceptAll(stdin, 4);
    await press(stdin, ARROW_DOWN);
    await press(stdin, ARROW_DOWN);
    await press(stdin, ARROW_DOWN);
    await press(stdin, ENTER);
    await press(stdin, "y");
    await acceptAll(stdin, 3);

    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ hostname: "0.0.0.0" }));
  });

  /**
   * Enter-through on a re-run must not quietly rewrite what is already stored.
   *
   * `claude-code` among the sources on purpose: without it the wizard skips the
   * claude directory and the executable entirely, so a version of this test that
   * stored `["codex"]` passed on initial state that was never asked about — it
   * proved nothing about the two answers it named.
   */
  it("keeps stored answers rather than the detected ones", async () => {
    const onDone = vi.fn();
    const { stdin } = render(
      <InitWizard
        detection={detection}
        initial={{
          sources: ["claude-code", "codex"],
          claudeDir: "/mnt/backup/claude",
          executable: "/opt/claude",
        }}
        onDone={onDone}
      />,
    );

    await nextFrame();
    await acceptAll(stdin, 8);

    expect(onDone).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: ["claude-code", "codex"],
        claudeDir: "/mnt/backup/claude",
        executable: "/opt/claude",
      }),
    );
  });

  /** The skip itself is worth pinning: no Claude Code, no questions about it. */
  it("does not ask about the claude directory when Claude Code is not being read", async () => {
    const onDone = vi.fn();
    const { stdin, lastFrame } = render(
      <InitWizard detection={detection} initial={{ sources: ["codex"] }} onDone={onDone} />,
    );

    await nextFrame();
    await press(stdin, ENTER);

    expect(lastFrame()).not.toContain("Claude Code keep its logs");
  });
});

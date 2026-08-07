import { render } from "ink-testing-library";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Detection } from "./detect.ts";
import { InitWizard } from "./InitWizard.tsx";

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
    await acceptAll(stdin, 8);

    expect(onDone).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: ["claude-code"],
        claudeDir: "/home/dev/.claude",
        executable: "/usr/local/bin/claude",
        port: 3000,
        hostname: "127.0.0.1",
        terminalDisabled: false,
        resumeAction: "resume-here",
        runSync: true,
      }),
    );
  });

  it("offers the executable it found", async () => {
    const { stdin, lastFrame } = setup();
    await nextFrame();
    await acceptAll(stdin, 2);

    expect(lastFrame()).toContain("Where is the claude executable?");
    expect(lastFrame()).toContain("Found /usr/local/bin/claude");
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

  it("asks for a terminal command only when a new window is the default", async () => {
    const { stdin, lastFrame } = setup();
    await nextFrame();
    await acceptAll(stdin, 6);
    await press(stdin, ARROW_DOWN);
    await press(stdin, ENTER);

    expect(lastFrame()).toContain("Which command opens a new terminal window?");
  });

  it("never leaves the user reading nothing at all", async () => {
    const { stdin, onDone } = setup();
    await nextFrame();
    await press(stdin, " ");
    await acceptAll(stdin, 8);

    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ sources: ["claude-code"] }));
  });
});

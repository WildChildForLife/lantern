import { describe, expect, it } from "vitest";
import {
  applyTerminalTemplate,
  buildEmulatorLaunch,
  candidateBinaries,
} from "./terminalEmulator.ts";

const params = { command: `claude --resume "abc"`, cwd: "/home/dev/lantern" };

describe("candidateBinaries", () => {
  it("prefers the terminal the user is already in", () => {
    expect(candidateBinaries("linux", { TERM_PROGRAM: "WezTerm" })[0]).toBe("wezterm");
  });

  it("offers AppleScript on macOS, which is the only way to pass a command", () => {
    expect(candidateBinaries("darwin", {})).toContain("osascript");
  });

  it("uses Windows Terminal from inside WSL", () => {
    expect(candidateBinaries("linux", { WSL_DISTRO_NAME: "Ubuntu" })[0]).toBe("wt.exe");
  });

  it("offers the common Linux emulators", () => {
    const candidates = candidateBinaries("linux", {});

    expect(candidates).toContain("gnome-terminal");
    expect(candidates).toContain("kitty");
    expect(candidates).toContain("alacritty");
  });

  it("never offers the same binary twice", () => {
    const candidates = candidateBinaries("linux", { TERM_PROGRAM: "WezTerm" });

    expect(candidates).toStrictEqual([...new Set(candidates)]);
  });
});

describe("buildEmulatorLaunch", () => {
  it("opens kitty in the conversation's own directory", () => {
    expect(buildEmulatorLaunch("kitty", params)?.args.slice(0, 2)).toStrictEqual([
      "--directory",
      "/home/dev/lantern",
    ]);
  });

  it("passes the command through to gnome-terminal after the separator", () => {
    const launch = buildEmulatorLaunch("gnome-terminal", params);

    expect(launch?.args).toContain("--");
    expect(launch?.args.at(-1)).toContain("claude --resume");
  });

  it("drives Terminal.app through AppleScript", () => {
    const launch = buildEmulatorLaunch("osascript", params);

    expect(launch?.binary).toBe("osascript");
    expect(launch?.args[0]).toBe("-e");
    expect(launch?.args[1]).toContain("do script");
    expect(launch?.args[1]).toContain("/home/dev/lantern");
  });

  /** Otherwise the window vanishes the moment the conversation is closed. */
  it("leaves a shell behind so the window survives the command", () => {
    expect(buildEmulatorLaunch("kitty", params)?.args.at(-1)).toContain("exec");
  });

  /**
   * Reached from inside WSL, where both the directory and the command are
   * POSIX — Windows Terminal can run neither without going back through wsl.
   */
  it("goes back through wsl.exe when opening a window from WSL", () => {
    const launch = buildEmulatorLaunch("wt.exe", params);

    expect(launch?.args).toContain("wsl.exe");
    expect(launch?.args).toContain("--cd");
    expect(launch?.args).toContain("/home/dev/lantern");
  });

  /** Every other recipe honours cwd; this one resumed in the wrong repo. */
  it("opens cmd.exe in the conversation's own directory", () => {
    const launch = buildEmulatorLaunch("cmd.exe", params);

    expect(launch?.args).toContain("/d");
    expect(launch?.args).toContain("/home/dev/lantern");
  });

  it("returns null for a binary it has no recipe for", () => {
    expect(buildEmulatorLaunch("nethack", params)).toBeNull();
  });
});

describe("applyTerminalTemplate", () => {
  it("substitutes the command and the directory", () => {
    const launch = applyTerminalTemplate("kitty --directory {{cwd}} sh -c {{command}}", params, {
      platform: "linux",
    });

    expect(launch.args.at(-1)).toContain("/home/dev/lantern");
    expect(launch.args.at(-1)).toContain("claude --resume");
  });

  it("runs the template through a shell so operators keep working", () => {
    expect(applyTerminalTemplate("foo && bar", params, { platform: "linux" })).toStrictEqual({
      binary: "sh",
      args: ["-c", "foo && bar"],
    });
  });

  it("uses the Windows shell on Windows", () => {
    expect(applyTerminalTemplate("wt.exe", params, { platform: "win32" }).binary).toBe("cmd.exe");
  });
});

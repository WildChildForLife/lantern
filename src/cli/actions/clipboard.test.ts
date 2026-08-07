import { describe, expect, it } from "vitest";
import { clipboardCommand, encodeOsc52 } from "./clipboard.ts";

const ESC = String.fromCodePoint(0x1b);
const BEL = String.fromCodePoint(0x07);

describe("encodeOsc52", () => {
  it("wraps the base64 payload in the clipboard escape sequence", () => {
    expect(encodeOsc52("lantern", {})).toBe(`${ESC}]52;c;${btoa("lantern")}${BEL}`);
  });

  /** Without the passthrough, tmux eats the sequence and nothing is copied. */
  it("wraps the sequence again for tmux", () => {
    const encoded = encodeOsc52("lantern", { TMUX: "/tmp/tmux-1000/default,123,0" });

    expect(encoded.startsWith(`${ESC}Ptmux;${ESC}`)).toBe(true);
    expect(encoded.endsWith(`${ESC}\\`)).toBe(true);
    expect(encoded).toContain(btoa("lantern"));
  });

  it("survives text outside latin-1, which raw btoa would reject", () => {
    expect(() => encodeOsc52("résumé — 会話", {})).not.toThrow();
  });
});

describe("clipboardCommand", () => {
  it("uses pbcopy on macOS", () => {
    expect(clipboardCommand("darwin", {})).toStrictEqual({ binary: "pbcopy", args: [] });
  });

  it("prefers the Wayland tool when running under Wayland", () => {
    expect(clipboardCommand("linux", { WAYLAND_DISPLAY: "wayland-0" })?.binary).toBe("wl-copy");
  });

  it("falls back to xclip on X11", () => {
    expect(clipboardCommand("linux", { DISPLAY: ":0" })?.binary).toBe("xclip");
  });

  it("uses clip.exe on Windows and from inside WSL", () => {
    expect(clipboardCommand("win32", {})?.binary).toBe("clip.exe");
    expect(clipboardCommand("linux", { WSL_DISTRO_NAME: "Ubuntu" })?.binary).toBe("clip.exe");
  });

  /** A headless Linux box has nowhere to put it; OSC 52 is the only route. */
  it("has nothing to offer a headless session", () => {
    expect(clipboardCommand("linux", {})).toBeNull();
  });
});

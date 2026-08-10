const ESC = String.fromCodePoint(0x1b);
const BEL = String.fromCodePoint(0x07);

export type ClipboardCommand = {
  binary: string;
  args: string[];
};

/**
 * Base64 that survives anything the user might have in a title.
 *
 * `btoa` throws on any code point above 255, and conversation titles are full
 * of em dashes and CJK, so the text goes through UTF-8 first.
 */
const toBase64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
};

/**
 * The escape sequence that asks the terminal itself to take a copy.
 *
 * This is the only route that works over SSH — a clipboard tool would copy to
 * the far end's clipboard, where nobody can paste from it.
 */
export const encodeOsc52 = (text: string, env: Record<string, string | undefined>): string => {
  const sequence = `${ESC}]52;c;${toBase64(text)}${BEL}`;

  // tmux swallows escape sequences it does not recognise unless they are
  // wrapped in its own passthrough.
  return env["TMUX"] === undefined ? sequence : `${ESC}Ptmux;${ESC}${sequence}${ESC}\\`;
};

/**
 * The local clipboard tool for this machine, if it has one.
 *
 * Used as a second attempt after OSC 52, for the terminals that ignore it.
 */
export const clipboardCommand = (
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): ClipboardCommand | null => {
  // A WSL session's clipboard is the Windows one.
  if (platform === "win32" || env["WSL_DISTRO_NAME"] !== undefined) {
    return { binary: "clip.exe", args: [] };
  }

  if (platform === "darwin") {
    return { binary: "pbcopy", args: [] };
  }

  if (env["WAYLAND_DISPLAY"] !== undefined) {
    return { binary: "wl-copy", args: [] };
  }

  if (env["DISPLAY"] !== undefined) {
    return { binary: "xclip", args: ["-selection", "clipboard"] };
  }

  return null;
};

import type { ResumeAction } from "../../config/cliConfig.ts";

/** The subset of Ink's key flags the board reacts to. */
export type KeyInput = {
  input: string;
  upArrow?: boolean | undefined;
  downArrow?: boolean | undefined;
  leftArrow?: boolean | undefined;
  rightArrow?: boolean | undefined;
  return?: boolean | undefined;
  escape?: boolean | undefined;
  ctrl?: boolean | undefined;
};

/** Which overlay, if any, currently owns the keyboard. */
export type BrowseMode = "board" | "filter" | "help";

export type BrowseAction =
  | { type: "quit" }
  | { type: "move-column"; delta: number }
  | { type: "move-row"; delta: number }
  | { type: "row-edge"; edge: "first" | "last" }
  | { type: "open-filter" }
  | { type: "close-overlay" }
  | { type: "toggle-help" }
  | { type: "refresh" }
  | { type: "run-chosen" }
  | { type: "cycle-enter-action" }
  | { type: "run"; action: ResumeAction };

/** Hotkeys that run an action straight from the board, skipping the menu. */
const DIRECT_ACTIONS: Record<string, ResumeAction> = {
  c: "copy-id",
  p: "print",
  o: "new-window",
  R: "resume-here",
};

const isQuit = (key: KeyInput): boolean =>
  (key.ctrl === true && key.input === "c") || key.input === "q" || key.input === "Q";

const resolveBoardAction = (key: KeyInput): BrowseAction | null => {
  if (key.leftArrow === true || key.input === "h") return { type: "move-column", delta: -1 };
  if (key.rightArrow === true || key.input === "l") return { type: "move-column", delta: 1 };
  if (key.upArrow === true || key.input === "k") return { type: "move-row", delta: -1 };
  if (key.downArrow === true || key.input === "j") return { type: "move-row", delta: 1 };
  if (key.input === "g") return { type: "row-edge", edge: "first" };
  if (key.input === "G") return { type: "row-edge", edge: "last" };
  if (key.input === "/") return { type: "open-filter" };
  if (key.input === "?") return { type: "toggle-help" };
  if (key.input === "r") return { type: "refresh" };
  if (key.input === "e") return { type: "cycle-enter-action" };
  // Enter does whatever the header says it does — `e` is what changes that.
  if (key.return === true) return { type: "run-chosen" };

  const direct = DIRECT_ACTIONS[key.input];

  return direct === undefined ? null : { type: "run", action: direct };
};

/**
 * Maps a keypress to what the board should do about it.
 *
 * Pure, and separate from the components, so the whole keymap — including the
 * parts that only apply while an overlay is open — is covered without
 * rendering anything.
 *
 * Returning null means "not mine": while the filter is open that hands the key
 * back to the text field, which owns cursor movement and editing.
 */
export const resolveKeyAction = (key: KeyInput, mode: BrowseMode): BrowseAction | null => {
  // Ctrl-C is the one key that means the same thing everywhere.
  if (key.ctrl === true && key.input === "c") {
    return { type: "quit" };
  }

  switch (mode) {
    case "board":
      return isQuit(key) ? { type: "quit" } : resolveBoardAction(key);
    case "filter":
      return key.return === true || key.escape === true ? { type: "close-overlay" } : null;
    case "help":
      return { type: "close-overlay" };
    default:
      mode satisfies never;
      return null;
  }
};

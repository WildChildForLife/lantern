/**
 * A redraw that stops working the moment the board is gone.
 *
 * Every redraw on the board is reached from a callback that can outlive it: a
 * re-read of the logs, a classification pass, the print that follows a directory
 * check. Press `r` and then `q` before it lands and the continuation still runs —
 * and rerendering an unmounted Ink app is not a no-op. Ink treats it as a fresh
 * mount: raw mode goes back on, a keypress listener re-attaches, stdin is
 * re-referenced so the process no longer exits, and nothing is drawn because the
 * renderer knows it is unmounted. The user is left at what looks like a shell
 * prompt with no echo and no working Ctrl-C.
 *
 * So the gate is not an optimisation. It is the difference between quitting and
 * hanging the terminal.
 */
export type Redraw = {
  /** Draws, unless the board has gone. */
  draw: () => void;
  /** Called once the board is unmounted. Every later `draw` does nothing. */
  stop: () => void;
  /** Whether the board is still on screen. */
  readonly live: boolean;
};

export const createRedraw = (rerender: () => void): Redraw => {
  let live = true;

  return {
    draw: () => {
      if (live) {
        rerender();
      }
    },
    stop: () => {
      live = false;
    },
    get live() {
      return live;
    },
  };
};

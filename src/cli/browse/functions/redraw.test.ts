import { describe, expect, it, vi } from "vitest";
import { createRedraw } from "./redraw.ts";

describe("createRedraw", () => {
  it("draws while the board is on screen", () => {
    const rerender = vi.fn();
    const redraw = createRedraw(rerender);

    redraw.draw();
    redraw.draw();

    expect(rerender).toHaveBeenCalledTimes(2);
  });

  /**
   * The regression this exists for: press `r`, then `q` before the re-read lands.
   * The continuation still runs, and rerendering an unmounted Ink app re-mounts
   * it — raw mode back on, stdin re-referenced, nothing drawn. The terminal is
   * left unusable and the process never exits.
   */
  it("draws nothing once the board has gone", () => {
    const rerender = vi.fn();
    const redraw = createRedraw(rerender);

    redraw.stop();
    redraw.draw();

    expect(rerender).not.toHaveBeenCalled();
  });

  it("stays stopped", () => {
    const rerender = vi.fn();
    const redraw = createRedraw(rerender);

    redraw.stop();
    redraw.stop();
    redraw.draw();

    expect(rerender).not.toHaveBeenCalled();
    expect(redraw.live).toBe(false);
  });

  it("says whether the board is still there", () => {
    const redraw = createRedraw(vi.fn());

    expect(redraw.live).toBe(true);
    redraw.stop();
    expect(redraw.live).toBe(false);
  });

  /** An in-flight re-read finishing after the quit is the whole point. */
  it("swallows a draw from a callback that outlived the board", async () => {
    const rerender = vi.fn();
    const redraw = createRedraw(rerender);

    const inFlight = Promise.resolve().then(() => {
      redraw.draw();
    });

    redraw.stop();
    await inFlight;

    expect(rerender).not.toHaveBeenCalled();
  });
});

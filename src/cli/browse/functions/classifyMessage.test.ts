import { describe, expect, it } from "vitest";
import { describeClassifyStatus } from "./classifyMessage.ts";

describe("describeClassifyStatus", () => {
  it("reports what a finished pass filed", () => {
    expect(
      describeClassifyStatus({ kind: "sorted", classified: 12, costUsd: 0, leftOver: 0 }),
    ).toStrictEqual({ text: "Sorted 12 into topics.", tone: "ok" });
  });

  /** Spending the user's CLI quota is not something to do quietly. */
  it("says what the pass cost when it cost anything", () => {
    expect(
      describeClassifyStatus({ kind: "sorted", classified: 12, costUsd: 0.004, leftOver: 0 })?.text,
    ).toBe("Sorted 12 into topics (0.004 USD of usage).");
  });

  /**
   * One line, so what the web app says in a second toast is joined on here — the
   * cap deferring work must not read as the work being finished.
   */
  it("says what the cap left for next time", () => {
    expect(
      describeClassifyStatus({ kind: "sorted", classified: 240, costUsd: 0, leftOver: 60 })?.text,
    ).toBe("Sorted 240 into topics. 60 were left for the next pass.");
  });

  it("reports a pass that gave up part way as a failure", () => {
    expect(
      describeClassifyStatus({ kind: "stopped-early", classified: 40, remaining: 12 }),
    ).toStrictEqual({
      text: "Sorted 40, then stopped early. 12 still have no topic.",
      tone: "error",
    });
  });

  it("says so when there was nothing to sort", () => {
    expect(describeClassifyStatus({ kind: "nothing-to-do" })).toStrictEqual({
      text: "Every conversation already has a topic.",
      tone: "ok",
    });
  });

  /** Reachable through the shared outcome type, even though the board never asks for a selection. */
  it("does not claim everything is filed when nothing matched", () => {
    expect(describeClassifyStatus({ kind: "nothing-matched" })).toStrictEqual({
      text: "None of those conversations could be sorted.",
      tone: "error",
    });
  });
});

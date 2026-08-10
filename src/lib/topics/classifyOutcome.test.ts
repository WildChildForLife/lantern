import { expect, test } from "vitest";
import type { ClassifyResult } from "../../server/core/session/schema.ts";
import { describeClassifyOutcome } from "./classifyOutcome.ts";

const result = (overrides: Partial<ClassifyResult> = {}): ClassifyResult => ({
  classified: 0,
  remaining: 0,
  batches: 0,
  costUsd: 0,
  requested: 0,
  queued: 0,
  failed: false,
  ...overrides,
});

test("a pass that gave up part way reports what is left", () => {
  expect(
    describeClassifyOutcome(
      result({ classified: 40, remaining: 12, requested: 52, queued: 52, failed: true }),
      "unclassified",
    ),
  ).toEqual({ kind: "stopped-early", classified: 40, remaining: 12 });
});

test("a default pass with nothing pending means everything is filed", () => {
  expect(describeClassifyOutcome(result(), "unclassified")).toEqual({ kind: "nothing-to-do" });
  expect(describeClassifyOutcome(result(), "all")).toEqual({ kind: "nothing-to-do" });
});

test("a selection that matched nothing does not claim everything is filed", () => {
  // The picks were unclassifiable - unknown ids, no text, or the classifier's
  // own runs. Saying "every conversation already has a topic" would be a lie.
  expect(describeClassifyOutcome(result(), "selection")).toEqual({ kind: "nothing-matched" });
});

test("a finished pass reports what it filed and what it cost", () => {
  expect(
    describeClassifyOutcome(
      result({ classified: 12, requested: 12, queued: 12, costUsd: 0.004 }),
      "unclassified",
    ),
  ).toEqual({ kind: "sorted", classified: 12, costUsd: 0.004, leftOver: 0 });
});

test("a capped pass reports what it left for next time", () => {
  expect(
    describeClassifyOutcome(result({ classified: 240, requested: 300, queued: 240 }), "all"),
  ).toEqual({ kind: "sorted", classified: 240, costUsd: 0, leftOver: 60 });
});

test("a CLI that answered but matched nothing is not 'already sorted'", () => {
  // The old wording claimed every conversation already had a topic here, which
  // was plainly untrue: one was asked about and came back unfiled.
  expect(
    describeClassifyOutcome(result({ classified: 0, requested: 1, queued: 1 }), "unclassified"),
  ).toEqual({
    kind: "sorted",
    classified: 0,
    costUsd: 0,
    leftOver: 0,
  });
});

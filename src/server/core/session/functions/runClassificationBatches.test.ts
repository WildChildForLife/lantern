import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";
import type { HeadlessAnswer } from "../../source/models/SourceAdapter.ts";
import { CLASSIFIER_MARKER, type ClassificationCandidate } from "./buildClassificationPrompt.ts";
import { runClassificationBatches } from "./runClassificationBatches.ts";

const candidates = (count: number): ClassificationCandidate[] =>
  Array.from({ length: count }, (_, index) => ({
    sessionId: `s${index}`,
    text: `Conversation ${index}`,
    projectPath: null,
  }));

const answer = (text: string, costUsd = 0): HeadlessAnswer => ({ text, costUsd });

describe("runClassificationBatches", () => {
  it.effect("slices the candidates into batches and re-reads topics per batch", () =>
    Effect.gen(function* () {
      let topicReads = 0;
      const askedSizes: number[] = [];

      const outcome = yield* runClassificationBatches(candidates(90), 40, {
        existingTopics: () => {
          topicReads += 1;
          return ["Shop"];
        },
        ask: () => Effect.succeed(answer("[]")),
        store: (batch) => {
          askedSizes.push(batch.length);
          return batch.length;
        },
      });

      expect(askedSizes).toEqual([40, 40, 10]);
      expect(topicReads).toBe(3);
      expect(outcome).toEqual({ classified: 90, batches: 3, costUsd: 0, failed: false });
    }),
  );

  it.effect("stops at the batch the CLI could not answer", () =>
    Effect.gen(function* () {
      let asks = 0;

      const outcome = yield* runClassificationBatches(candidates(120), 40, {
        existingTopics: () => [],
        ask: () => {
          asks += 1;
          return Effect.succeed(asks === 2 ? null : answer("[]", 0.002));
        },
        store: (batch) => batch.length,
      });

      expect(asks).toBe(2);
      expect(outcome).toEqual({ classified: 40, batches: 1, costUsd: 0.002, failed: true });
    }),
  );

  it.effect("stops when an answer stored nothing", () =>
    Effect.gen(function* () {
      let asks = 0;

      const outcome = yield* runClassificationBatches(candidates(120), 40, {
        existingTopics: () => [],
        ask: () => {
          asks += 1;
          return Effect.succeed(answer("sorry, no", 0.001));
        },
        store: () => 0,
      });

      expect(asks).toBe(1);
      expect(outcome).toEqual({ classified: 0, batches: 1, costUsd: 0.001, failed: true });
    }),
  );

  it.effect("adds up what each batch cost", () =>
    Effect.gen(function* () {
      const outcome = yield* runClassificationBatches(candidates(3), 1, {
        existingTopics: () => [],
        ask: () => Effect.succeed(answer("[]", 0.5)),
        store: () => 1,
      });

      expect(outcome.batches).toBe(3);
      expect(outcome.costUsd).toBeCloseTo(1.5);
    }),
  );

  it.effect("asks nothing when there is nothing to classify", () =>
    Effect.gen(function* () {
      let asks = 0;

      const outcome = yield* runClassificationBatches([], 40, {
        existingTopics: () => [],
        ask: () => {
          asks += 1;
          return Effect.succeed(answer("[]"));
        },
        store: () => 0,
      });

      expect(asks).toBe(0);
      expect(outcome).toEqual({ classified: 0, batches: 0, costUsd: 0, failed: false });
    }),
  );

  it.effect("asks with a prompt built from the batch it is about", () =>
    Effect.gen(function* () {
      const prompts: string[] = [];

      yield* runClassificationBatches(candidates(2), 1, {
        existingTopics: () => ["Shop"],
        ask: (prompt) => {
          prompts.push(prompt);
          return Effect.succeed(answer("[]"));
        },
        store: () => 1,
      });

      expect(prompts).toHaveLength(2);
      expect(prompts[0]).toContain(CLASSIFIER_MARKER);
      expect(prompts[0]).toContain("Conversation 0");
      expect(prompts[0]).not.toContain("Conversation 1");
      expect(prompts[1]).toContain("Conversation 1");
    }),
  );
});

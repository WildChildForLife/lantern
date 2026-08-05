import { Effect } from "effect";
import type { HeadlessAnswer } from "../../source/models/SourceAdapter.ts";
import {
  buildClassificationPrompt,
  type ClassificationCandidate,
} from "./buildClassificationPrompt.ts";

/**
 * The batching loop, kept out of the service so it can be tested without a
 * CommandExecutor or a database behind it.
 */

/**
 * `R` is whatever asking the CLI needs in context - a command executor and the
 * options that can name an executable. Left generic so a test can supply an
 * `ask` that needs nothing at all.
 */
export type ClassificationBatchDeps<R = never> = {
  /** Topic names offered back for reuse. Re-read per batch on purpose. */
  readonly existingTopics: () => readonly string[];
  /** null when the CLI could not answer; the caller has already logged why. */
  readonly ask: (prompt: string) => Effect.Effect<HeadlessAnswer | null, never, R>;
  /** How many of the batch were stored. */
  readonly store: (batch: readonly ClassificationCandidate[], answer: string) => number;
};

export type ClassificationBatchOutcome = {
  readonly classified: number;
  readonly batches: number;
  readonly costUsd: number;
  readonly failed: boolean;
};

/**
 * Batches run one after the other rather than in parallel: they share a topic
 * vocabulary, so a later batch can reuse the names an earlier one settled on.
 * Without that, every batch invents its own near-duplicate wording.
 */
export const runClassificationBatches = <R = never>(
  candidates: readonly ClassificationCandidate[],
  batchSize: number,
  deps: ClassificationBatchDeps<R>,
): Effect.Effect<ClassificationBatchOutcome, never, R> =>
  Effect.gen(function* () {
    let classified = 0;
    let batches = 0;
    let costUsd = 0;
    let failed = false;

    for (let offset = 0; offset < candidates.length; offset += batchSize) {
      const batch = candidates.slice(offset, offset + batchSize);
      if (batch.length === 0) break;

      const answer = yield* deps.ask(buildClassificationPrompt(batch, deps.existingTopics()));
      if (answer === null) {
        failed = true;
        break;
      }

      const stored = deps.store(batch, answer.text);
      batches += 1;
      classified += stored;
      costUsd += answer.costUsd;

      // An unusable answer means the next batch would likely fail the same way;
      // stopping keeps a broken run cheap.
      if (stored === 0) {
        failed = true;
        break;
      }
    }

    return { classified, batches, costUsd, failed };
  });

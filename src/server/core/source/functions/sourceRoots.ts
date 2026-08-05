import { Effect } from "effect";
import type { SourceAdapter, SourceEnv } from "../models/SourceAdapter.ts";
import type { SourceId } from "../models/SourceId.ts";

export type SourceRoots = ReadonlyMap<SourceId, readonly string[]>;

/**
 * The directories each registered source reads, resolved once.
 *
 * Every guard that turns a request id into a path needs this, and each of them
 * needs the *same* answer: a path is safe when it lies under the roots of the
 * one source that owns it, never under the union. Checking the union would let
 * a Codex path pass on the strength of the Claude directory, and with it a
 * capability check the Codex adapter refuses.
 *
 * Every known adapter is included rather than only the enabled ones. Disabling
 * a source purges its rows, so a row that still exists must still be checkable.
 *
 * Roots follow from the directories the server was started with, so they are
 * fixed for the process and resolved at layer construction.
 */
export const resolveSourceRoots = (
  adapters: readonly SourceAdapter[],
): Effect.Effect<SourceRoots, never, SourceEnv> =>
  Effect.gen(function* () {
    const bySource = new Map<SourceId, readonly string[]>();

    for (const adapter of adapters) {
      bySource.set(adapter.id, yield* adapter.roots());
    }

    return bySource;
  });

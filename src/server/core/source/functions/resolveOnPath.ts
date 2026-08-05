import { Command } from "@effect/platform";
import { Effect } from "effect";
import { HeadlessUnavailableError } from "../models/SourceAdapter.ts";
import type { SourceId } from "../models/SourceId.ts";

/**
 * Finds a CLI on `PATH`.
 *
 * `where` on Windows and `which -a` elsewhere both list every match, one per
 * line; the first is what a shell would run, which is what the user means when
 * they say they have the CLI installed.
 */
export const resolveOnPath = (sourceId: SourceId, binary: string) =>
  Effect.gen(function* () {
    const lookup =
      process.platform === "win32"
        ? Command.make("where", binary)
        : Command.make("which", "-a", binary);

    const found = yield* Command.string(lookup).pipe(
      Effect.map((output) =>
        output
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== ""),
      ),
      Effect.catchAll(() => Effect.succeed<string[]>([])),
    );

    const first = found.at(0);
    if (first === undefined) {
      return yield* new HeadlessUnavailableError({
        sourceId,
        reason: `${binary} is not on PATH`,
      });
    }

    return first;
  });

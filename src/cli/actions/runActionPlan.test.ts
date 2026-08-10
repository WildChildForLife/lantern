import { FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";
import { directoryExists, handOver } from "./runActionPlan.ts";

const withTempDir = <A, E>(
  use: (dir: string) => Effect.Effect<A, E, FileSystem.FileSystem>,
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* use(yield* fs.makeTempDirectoryScoped());
    }).pipe(Effect.scoped, Effect.provide(NodeContext.layer)),
  );

describe("directoryExists", () => {
  it.live("reports whether a directory is still there", () =>
    Effect.promise(() =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          expect(yield* Effect.promise(() => directoryExists(dir))).toBe(true);
          expect(yield* Effect.promise(() => directoryExists(`${dir}/gone`))).toBe(false);
        }),
      ),
    ),
  );
});

describe("handOver", () => {
  /**
   * The board is redrawn afterwards, so the exit code is the one thing that says
   * how the session went — and it has to be the child's, not Lantern's.
   */
  it.live("waits for the session and reports how it ended", () =>
    Effect.promise(() =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          expect(yield* Effect.promise(() => handOver("sh", ["-c", "exit 0"], dir))).toBe(0);
          expect(yield* Effect.promise(() => handOver("sh", ["-c", "exit 3"], dir))).toBe(3);
        }),
      ),
    ),
  );

  it.live("runs the session in the conversation's own directory", () =>
    Effect.promise(() =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          yield* Effect.promise(() => handOver("sh", ["-c", "touch resumed-here"], dir));

          expect(yield* fs.exists(`${dir}/resumed-here`)).toBe(true);
        }),
      ),
    ),
  );

  /**
   * A `claude` that is not on PATH must come back as a code the board can report,
   * not as a rejected promise: the board is already unmounted by then, and an
   * unhandled rejection would kill the process with the terminal mid-handover.
   */
  it.live("comes back with a code when the executable is not there at all", () =>
    Effect.promise(() =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          expect(yield* Effect.promise(() => handOver("lantern-no-such-binary", [], dir))).toBe(
            127,
          );
        }),
      ),
    ),
  );
});

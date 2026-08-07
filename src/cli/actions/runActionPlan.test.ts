import { FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";
import { directoryExists, spawnDetached } from "./runActionPlan.ts";

const withTempDir = <A, E>(
  use: (dir: string) => Effect.Effect<A, E, FileSystem.FileSystem>,
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* use(yield* fs.makeTempDirectoryScoped());
    }).pipe(Effect.scoped, Effect.provide(NodeContext.layer)),
  );

/** The window is opened and let go of; give it a moment to appear. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 500));

describe("spawnDetached", () => {
  it.live("really starts the command", () =>
    Effect.promise(() =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const marker = `${dir}/opened`;

          yield* Effect.promise(() => spawnDetached("touch", [marker], dir, "linux"));
          yield* Effect.promise(settle);

          expect(yield* fs.exists(marker)).toBe(true);
        }),
      ),
    ),
  );

  /**
   * The regression this exists for: a live child handle keeps Node alive, so
   * `lantern browse` would sit there after `q` until every window the user had
   * opened was closed. What is waited on here must be the launching shell, not
   * the window.
   */
  it.live("returns without waiting for the window to close", () =>
    Effect.promise(() =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          const started = Date.now();
          yield* Effect.promise(() => spawnDetached("sleep", ["5"], dir, "linux"));

          expect(Date.now() - started).toBeLessThan(2000);
        }),
      ),
    ),
  );

  /**
   * The board refuses before it gets here, because `claude --resume` finds a
   * session by the directory it runs in — starting it somewhere else reports
   * the conversation as missing rather than resuming it.
   */
  it.live("does not invent a directory when the conversation's is gone", () =>
    Effect.promise(() =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const marker = `${dir}/should-not-appear`;

          yield* Effect.promise(() =>
            spawnDetached("touch", [marker], `${dir}/deleted-long-ago`, "linux"),
          );
          yield* Effect.promise(settle);

          expect(yield* fs.exists(marker)).toBe(false);
        }),
      ),
    ),
  );

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

  it.live("does not throw when the binary is not there", () =>
    Effect.promise(() =>
      withTempDir((dir) =>
        Effect.promise(() => spawnDetached("lantern-no-such-binary", [], dir, "linux")).pipe(
          Effect.map(() => {
            expect(true).toBe(true);
          }),
        ),
      ),
    ),
  );
});

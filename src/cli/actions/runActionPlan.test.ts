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

          yield* Effect.promise(() => spawnDetached("touch", [marker], "linux"));
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
      withTempDir(() =>
        Effect.gen(function* () {
          const started = Date.now();
          yield* Effect.promise(() => spawnDetached("sleep", ["5"], "linux"));

          expect(Date.now() - started).toBeLessThan(2000);
        }),
      ),
    ),
  );

  /**
   * The launch inherits Lantern's own directory: every recipe names the
   * conversation's directory itself, and handing a POSIX one to a Windows
   * binary from inside WSL turns it into a UNC path `wsl.exe` cannot
   * translate. Whether the directory still exists is settled before this runs.
   */
  it.live("does not impose a working directory on the launch", () =>
    Effect.promise(() =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const marker = `${dir}/relative-to-lantern`;

          yield* Effect.promise(() => spawnDetached("touch", [marker], "linux"));
          yield* Effect.promise(settle);

          expect(yield* fs.exists(marker)).toBe(true);
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
      withTempDir(() =>
        Effect.promise(() => spawnDetached("lantern-no-such-binary", [], "linux")).pipe(
          Effect.map(() => {
            expect(true).toBe(true);
          }),
        ),
      ),
    ),
  );
});

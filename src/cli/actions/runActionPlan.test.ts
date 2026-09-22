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

  /**
   * The whole point of the hand-over: the session has to end up in the same
   * terminal session Lantern is in, holding the same controlling terminal.
   *
   * A child spawned with `detached` gets a session of its own through
   * `setsid()`, and with it no controlling terminal at all — Ctrl+C and a
   * resize would go to Lantern instead, and a full-screen prompt that opens
   * `/dev/tty` (Claude Code's trust dialog among them) would find nothing
   * there and sit unable to take a keystroke.
   */
  it.live("leaves the session in Lantern's own terminal session", () =>
    Effect.promise(() =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          yield* Effect.promise(() =>
            handOver(
              "sh",
              ["-c", `ps -o sid= -p $$ > child; ps -o sid= -p ${process.pid} > lantern`],
              dir,
            ),
          );

          const child = yield* fs.readFileString(`${dir}/child`);
          const lantern = yield* fs.readFileString(`${dir}/lantern`);

          expect(child.trim()).toBe(lantern.trim());
        }),
      ),
    ),
  );

  /**
   * Ctrl+C in a resumed session belongs to the session. The terminal sends it
   * to every process in the foreground group, which the child is now part of,
   * so Lantern has to sit the signal out rather than die halfway through a
   * hand-over — with the board unmounted, the screen the child's, and the
   * terminal left in whatever mode the child had put it in.
   *
   * And it has to stop sitting them out afterwards, so the board is not left
   * deaf to a signal for the rest of the run.
   */
  it.live("sits out the terminal's signals for as long as the session runs", () =>
    Effect.promise(() =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          const before = process.listenerCount("SIGINT");

          const handedOver = handOver("sh", ["-c", "exit 0"], dir);
          expect(process.listenerCount("SIGINT")).toBe(before + 1);

          yield* Effect.promise(() => handedOver);
          expect(process.listenerCount("SIGINT")).toBe(before);
        }),
      ),
    ),
  );
});

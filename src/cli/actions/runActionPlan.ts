import { Command, type CommandExecutor } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { clipboardCommand, encodeOsc52 } from "./clipboard.ts";
import { candidateBinaries } from "./terminalEmulator.ts";

const run = <A, E>(effect: Effect.Effect<A, E, CommandExecutor.CommandExecutor>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeContext.layer)));

/** Whether a binary is on PATH, without caring what it prints. */
const isOnPath = (binary: string, platform: NodeJS.Platform) =>
  Command.make(platform === "win32" ? "where" : "which", binary).pipe(
    Command.exitCode,
    Effect.map((code) => code === 0),
    Effect.catchAll(() => Effect.succeed(false)),
  );

/**
 * The first terminal emulator this machine actually has.
 *
 * Probed rather than assumed: the candidate list is the same everywhere, and
 * most of it is not installed on any given machine.
 */
export const findEmulator = (
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): Promise<string | null> =>
  run(
    Effect.gen(function* () {
      for (const binary of candidateBinaries(platform, env)) {
        if (yield* isOnPath(binary, platform)) {
          return binary;
        }
      }

      return null;
    }),
  );

/**
 * Puts text on the clipboard, by both routes.
 *
 * OSC 52 first, because it is the only one that reaches the clipboard of the
 * machine the user is sitting at when Lantern is running over SSH. Not every
 * terminal honours it and there is no reply to wait for, so the local tool
 * runs too when there is one — copying twice is harmless, copying nowhere is
 * not.
 */
export const copyToClipboard = async (
  text: string,
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  write: (chunk: string) => void,
): Promise<boolean> => {
  write(encodeOsc52(text, env));

  const local = clipboardCommand(platform, env);
  if (local === null) {
    return true;
  }

  return run(
    Command.make(local.binary, ...local.args).pipe(
      Command.feed(text),
      Command.exitCode,
      Effect.map((code) => code === 0),
      // The escape sequence has already gone out; a missing `xclip` is not a
      // failure worth reporting over it.
      Effect.catchAll(() => Effect.succeed(true)),
    ),
  );
};

/**
 * Opens a terminal window and lets go of it.
 *
 * Forked rather than awaited: emulators like kitty and wezterm do not return
 * until their window is closed, and the board has to stay usable in the
 * meantime. Its output is dropped rather than inherited, since anything it
 * printed would land on top of the board.
 */
export const spawnDetached = (binary: string, args: string[], cwd: string): void => {
  Effect.runFork(
    Command.make(binary, ...args).pipe(
      Command.workingDirectory(cwd),
      Command.stdout("pipe"),
      Command.stderr("pipe"),
      Command.exitCode,
      Effect.catchAll(() => Effect.succeed(1)),
      Effect.provide(NodeContext.layer),
    ),
  );
};

/**
 * Replaces this process with the conversation.
 *
 * Node has no `execve`, so the nearest thing is a child that inherits the
 * terminal while Lantern waits on it. The board is already unmounted by the
 * time this runs, so nothing is competing for the screen.
 */
export const handOver = (binary: string, args: string[], cwd: string): Promise<number> =>
  run(
    Command.make(binary, ...args).pipe(
      Command.workingDirectory(cwd),
      Command.stdin("inherit"),
      Command.stdout("inherit"),
      Command.stderr("inherit"),
      Command.exitCode,
      Effect.catchAll(() => Effect.succeed(127)),
    ),
  );

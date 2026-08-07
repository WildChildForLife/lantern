import { Command, type CommandExecutor, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { shellEscape } from "../../lib/shell/shellEscape.ts";
import { clipboardCommand, encodeOsc52 } from "./clipboard.ts";
import { candidateBinaries } from "./terminalEmulator.ts";

const run = <A, E>(
  effect: Effect.Effect<A, E, CommandExecutor.CommandExecutor | FileSystem.FileSystem>,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(NodeContext.layer)));

/**
 * The directory to start the conversation in, if it is still there.
 *
 * Lantern's whole point is conversations you had forgotten, and the repository
 * one of them ran in may well have been deleted since. Spawning into a missing
 * directory fails outright, so fall back to where Lantern was started rather
 * than refusing to resume at all.
 */
const usableDirectory = (cwd: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(cwd).pipe(Effect.catchAll(() => Effect.succeed(false)));

    return exists ? cwd : process.cwd();
  });

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
 * Opens a terminal window and genuinely lets go of it.
 *
 * kitty, wezterm, alacritty and the rest do not return until their window is
 * closed, so this cannot be awaited — but it cannot simply be forked either: a
 * live child handle keeps Node alive, and `lantern browse` would then sit
 * there after `q` until the user closed every window they had opened. So the
 * emulator is started by a shell that backgrounds it and exits; the window is
 * reparented and outlives Lantern, which is the point of it.
 *
 * The cost of that is knowledge: once the launching shell has backgrounded the
 * emulator it exits 0 whether or not the emulator itself ever started, so this
 * deliberately reports only that the attempt was made. The caller says
 * "opening", not "opened", and the emulator is checked against PATH by
 * `findEmulator` before it is ever chosen.
 */
export const spawnDetached = (
  binary: string,
  args: string[],
  cwd: string,
  platform: NodeJS.Platform,
): Promise<void> => {
  const launch = [binary, ...args].map(shellEscape).join(" ");

  const command =
    platform === "win32"
      ? // `start` returns as soon as the window exists.
        Command.make("cmd.exe", "/c", "start", "", binary, ...args)
      : Command.make("sh", "-c", `${launch} </dev/null >/dev/null 2>&1 &`);

  return run(
    Effect.gen(function* () {
      const directory = yield* usableDirectory(cwd);

      yield* command.pipe(
        Command.workingDirectory(directory),
        Command.stdout("pipe"),
        Command.stderr("pipe"),
        Command.exitCode,
        Effect.catchAll(() => Effect.succeed(1)),
      );
    }),
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
    Effect.gen(function* () {
      const directory = yield* usableDirectory(cwd);

      return yield* Command.make(binary, ...args).pipe(
        Command.workingDirectory(directory),
        Command.stdin("inherit"),
        Command.stdout("inherit"),
        Command.stderr("inherit"),
        Command.exitCode,
        Effect.catchAll(() => Effect.succeed(127)),
      );
    }),
  );

import { Command, type CommandExecutor, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { clipboardCommand, encodeOsc52 } from "./clipboard.ts";

const run = <A, E>(
  effect: Effect.Effect<A, E, CommandExecutor.CommandExecutor | FileSystem.FileSystem>,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(NodeContext.layer)));

/**
 * Whether a conversation's directory is still there.
 *
 * Checked before resuming rather than fallen back from: `claude --resume`
 * looks a session up under the directory it runs in, so starting it anywhere
 * else does not resume in the wrong place — it reports the conversation as
 * missing, which is a far more confusing failure than being told the folder
 * has gone.
 */
export const directoryExists = (path: string): Promise<boolean> =>
  run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      return yield* fs.exists(path).pipe(Effect.catchAll(() => Effect.succeed(false)));
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
 * Lends the terminal to the conversation, and takes it back afterwards.
 *
 * Node has no `execve`, so the nearest thing is a child that inherits the
 * terminal while Lantern waits on it. The board is unmounted and off the
 * alternate screen by the time this runs, so nothing is competing for the
 * screen — and when the session ends, the board is drawn again rather than the
 * process exiting with it.
 */
export const handOver = (binary: string, args: string[], cwd: string): Promise<number> =>
  run(
    Effect.gen(function* () {
      return yield* Command.make(binary, ...args).pipe(
        Command.workingDirectory(cwd),
        Command.stdin("inherit"),
        Command.stdout("inherit"),
        Command.stderr("inherit"),
        Command.exitCode,
        Effect.catchAll(() => Effect.succeed(127)),
      );
    }),
  );

// oxlint-disable-next-line no-restricted-imports -- Effect's CommandExecutor always spawns detached; see handOver
import { spawn } from "node:child_process";
// oxlint-disable-next-line no-restricted-imports -- the signal-number table behind 128 + n; see exitCode
import os from "node:os";
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
 * Signals the terminal sends to the whole foreground process group.
 *
 * SIGTSTP is deliberately not among them. Ctrl+Z has to stop Lantern along
 * with the session, because a shell resumes the group it stopped: sitting that
 * one out would leave Lantern waiting on a child that is never coming back.
 */
const TERMINAL_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGQUIT"];

const noop = () => {};

/**
 * Lets the session have the signals the terminal is about to send.
 *
 * The child shares Lantern's process group — which is what keeps it in the
 * foreground — so Ctrl+C reaches both of them. Claude Code's own handler is
 * the one that should act on it; Lantern only has to survive it, since dying
 * here would leave the board unmounted, the screen half the child's, and the
 * terminal in whatever mode the session had put it in. Handlers rather than
 * `SIG_IGN`: an ignored signal is inherited, and the session would never see
 * its own Ctrl+C.
 */
const holdSignals = (): (() => void) => {
  for (const signal of TERMINAL_SIGNALS) {
    process.on(signal, noop);
  }

  return () => {
    for (const signal of TERMINAL_SIGNALS) {
      process.off(signal, noop);
    }
  };
};

/**
 * The code a session that was killed rather than finished comes back with.
 *
 * The shell convention, because the board reports it to a user who may well
 * have been the one pressing the key that sent it.
 */
const exitCode = (code: number | null, signal: NodeJS.Signals | null): number => {
  if (code !== null) {
    return code;
  }

  // Node gives a name, and the number behind it is what 128 + n is counted
  // from. An unknown name is not worth a lookup table of its own.
  const number = signal === null ? 0 : (os.constants.signals[signal] ?? 0);
  return 128 + number;
};

/**
 * Lends the terminal to the conversation, and takes it back afterwards.
 *
 * Node has no `execve`, so the nearest thing is a child that inherits the
 * terminal while Lantern waits on it. The board is unmounted and off the
 * alternate screen by the time this runs, so nothing is competing for the
 * screen — and when the session ends, the board is drawn again rather than the
 * process exiting with it.
 *
 * Spawned by hand rather than through `Command`, which is how every other
 * process in Lantern is run: Effect's Node executor always passes
 * `detached: true` on POSIX and offers no way to turn it off. That calls
 * `setsid()`, and a session in a session of its own has no controlling
 * terminal — Ctrl+C and every resize would go to Lantern instead, and a
 * full-screen prompt that reaches for `/dev/tty`, Claude Code's "do you trust
 * this folder" dialog among them, would find nothing there and sit unable to
 * take a keystroke.
 */
export const handOver = (binary: string, args: string[], cwd: string): Promise<number> =>
  new Promise((resolve) => {
    const release = holdSignals();
    const child = spawn(binary, args, { cwd, stdio: "inherit", detached: false });

    const settle = (code: number) => {
      release();
      resolve(code);
    };

    // The board is already unmounted by the time this runs, so a `claude` that
    // is not on PATH has to come back as a code the board can report rather
    // than a rejection: an unhandled one would kill Lantern mid-hand-over.
    child.once("error", () => settle(127));
    child.once("exit", (code, signal) => settle(exitCode(code, signal)));
  });

import { Command, type CommandExecutor } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";

const run = <A, E>(effect: Effect.Effect<A, E, CommandExecutor.CommandExecutor>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeContext.layer)));

/**
 * Hands the terminal to the package manager and reports how it went.
 *
 * The child inherits the terminal rather than being captured: `npm install -g`
 * takes tens of seconds and writes progress as it goes, and buffering that
 * would leave the user watching nothing. The cost is that Lantern cannot read
 * the failure text, which is why a non-zero exit prints a fixed remediation
 * block instead of quoting the error.
 *
 * No working directory is set. A global install must not depend on where it was
 * started from, and leaving the directory alone lets a local `.npmrc` — a
 * registry mirror, a proxy — apply exactly as it would if the user had typed
 * the command.
 */
export const runUpgradeCommand = (binary: string, args: readonly string[]): Promise<number> =>
  run(
    Command.make(binary, ...args).pipe(
      Command.stdin("inherit"),
      Command.stdout("inherit"),
      Command.stderr("inherit"),
      Command.exitCode,
      // A package manager that is not on PATH has to come back as a code the
      // command can report, not as a rejected promise.
      Effect.catchAll(() => Effect.succeed(127)),
    ),
  );

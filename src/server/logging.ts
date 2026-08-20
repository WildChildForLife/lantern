import { type Effect, LogLevel, Logger } from "effect";

/**
 * How much the server says for itself.
 *
 * `quiet` is what a bare `lantern` uses, where the server and the terminal
 * board share one process and one screen: every routine line the server would
 * print lands on top of the board Ink is drawing. Warnings and errors still get
 * through, because those are worth a corrupted frame; "Starting file watcher"
 * is not. Asking for `--verbose` outranks it — somebody who wants the logs has
 * said so.
 */
export const resolveLogLevel = (verbose: boolean | undefined, quiet?: boolean) => {
  if (verbose === true) {
    return LogLevel.Debug;
  }

  return quiet === true ? LogLevel.Warning : LogLevel.Info;
};

export const serverLoggerLayer = Logger.replace(Logger.defaultLogger, Logger.prettyLogger());

export const withServerLogLevel =
  (verbose: boolean | undefined, quiet?: boolean) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Logger.withMinimumLogLevel(resolveLogLevel(verbose, quiet)));

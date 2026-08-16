import { isUpgrade } from "../../lib/version/semver.ts";
import type { InstallSource } from "../upgrade/installSource.ts";

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type UpdateNotifierContext = {
  /** Whether there is a terminal to write the notice to. */
  isInteractive: boolean;
  env: Record<string, string | undefined>;
  /** Whether `updateNotifier: false` is stored in the settings file. */
  configOptOut: boolean;
  installSource: InstallSource["kind"];
};

export type UpdateCheckContext = UpdateNotifierContext & {
  /** When the registry was last asked, or null if it never has been. */
  lastCheckedAt: number | null;
  now: number;
  intervalMs: number;
};

/**
 * Installs that can act on a notice.
 *
 * The rest are told nothing, because there is nothing for them to do with it: a
 * container replaces an image, a checkout pulls, an npx run already fetched the
 * newest version, and the retired packages have no newer version to move to —
 * that one is `lantern upgrade`'s message to deliver once, not a line on every
 * launch.
 */
const NOTIFIABLE: ReadonlySet<InstallSource["kind"]> = new Set([
  "npm-global",
  "homebrew",
  "unknown",
]);

export const isNotifiable = (kind: InstallSource["kind"]): boolean => NOTIFIABLE.has(kind);

const isSet = (value: string | undefined): boolean => value !== undefined && value !== "";

/**
 * Whether Lantern should say nothing about versions at all.
 *
 * One predicate for both halves — the notice and the request behind it —
 * because they have to agree: `NO_UPDATE_NOTIFIER` that stopped the request but
 * still printed yesterday's answer would be a variable that does not do what it
 * says. Read alongside `shouldRunWizard`: same shape, same rule that an
 * exported-but-empty variable is not a yes.
 */
export const isUpdateNotifierSilenced = ({
  isInteractive,
  env,
  configOptOut,
  installSource,
}: UpdateNotifierContext): boolean =>
  !isInteractive ||
  configOptOut ||
  !isNotifiable(installSource) ||
  isSet(env["CI"]) ||
  isSet(env["NO_UPDATE_NOTIFIER"]) ||
  isSet(env["LANTERN_NO_UPDATE_NOTIFIER"]);

/** Whether to ask the registry what has been published, and how long ago it was asked. */
export const shouldCheckForUpdate = ({
  lastCheckedAt,
  now,
  intervalMs,
  ...notifier
}: UpdateCheckContext): boolean => {
  if (isUpdateNotifierSilenced(notifier)) {
    return false;
  }

  if (lastCheckedAt === null) {
    return true;
  }

  const elapsed = now - lastCheckedAt;

  // A negative gap means the clock moved back — a restored backup, a laptop
  // waking up wrong. Asking again costs one request; the alternative is a check
  // that never runs again.
  return elapsed < 0 || elapsed >= intervalMs;
};

/**
 * The line printed when a newer release is already known about.
 *
 * Always from the cache the last check wrote, never from a live request: a
 * notice that waits on the network is a notice that delays the board.
 */
export const updateNotice = (
  current: string,
  cached: string | null,
  installSource: InstallSource["kind"],
): string | null => {
  if (cached === null || !isNotifiable(installSource) || !isUpgrade(current, cached)) {
    return null;
  }

  const how = installSource === "homebrew" ? "brew upgrade lantern-viewer" : "lantern upgrade";

  return `Lantern ${cached} is available (you have ${current}). Run \`${how}\`.`;
};

const HELP_FLAGS = new Set(["--version", "-V", "--help", "-h", "help"]);
/** Every subcommand `registerCliCommands` declares, aliases included. */
const COMMANDS = new Set(["init", "browse", "b", "upgrade"]);
/** The ones that stay running long enough to carry a background request. */
const CHECKED_COMMANDS = new Set(["browse", "b"]);

/**
 * Whether this invocation is one the check can run alongside.
 *
 * Only the two commands that stay running anyway: an in-flight request holds
 * the event loop open, so firing one from `lantern --version` would leave it
 * sitting there after it had already said everything it was going to say.
 */
export const wantsUpdateCheck = (argv: readonly string[]): boolean => {
  // node, then the script itself.
  const args = argv.slice(2);

  if (args.some((arg) => HELP_FLAGS.has(arg))) {
    return false;
  }

  // Matched against the command names rather than "the first thing that is not
  // a flag", because an option's value — `--port 3400` — is not a flag either.
  const command = args.find((arg) => COMMANDS.has(arg));

  return command === undefined || CHECKED_COMMANDS.has(command);
};

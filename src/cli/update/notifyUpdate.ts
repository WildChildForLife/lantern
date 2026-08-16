import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import packageJson from "../../../package.json" with { type: "json" };
import { EnvService } from "../../server/core/platform/services/EnvService.ts";
import { CliConfigBaseDir, readCliConfig } from "../config/cliConfigStore.ts";
import { detectInstallSource } from "../upgrade/detectInstall.ts";
import { fetchLatestVersion } from "./latestVersion.ts";
import { readUpdateCache, type UpdateCache, writeUpdateCache } from "./updateCache.ts";
import {
  isNotifiable,
  isUpdateNotifierSilenced,
  shouldCheckForUpdate,
  UPDATE_CHECK_INTERVAL_MS,
  updateNotice,
  wantsUpdateCheck,
} from "./updateCheck.ts";

const runQuietly = <A>(
  effect: Effect.Effect<A, unknown, CliConfigBaseDir | EnvService | NodeContext.NodeContext>,
  fallback: A,
): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.catchAll(() => Effect.succeed(fallback)),
      Effect.provide(CliConfigBaseDir.Live),
      Effect.provide(EnvService.Live),
      Effect.provide(NodeContext.layer),
    ),
  );

/**
 * Asks the registry and remembers the answer for the next launch.
 *
 * Nothing is printed from here. The notice always comes from the cache, so a
 * slow or unreachable registry can never hold up a command or write over a
 * screen the board has already taken.
 */
const refreshCache = (now: number): Promise<void> =>
  runQuietly(
    Effect.gen(function* () {
      const latest = yield* Effect.promise(() => fetchLatestVersion());
      if (latest === null) {
        return;
      }

      yield* writeUpdateCache({ checkedAt: now, latest });
    }),
    undefined,
  );

/**
 * Prints the one line saying a newer Lantern exists, when there is one.
 *
 * Awaited by `main` before the command runs, and deliberately cheap enough to
 * be: two small file reads and no network. The request that refreshes the cache
 * is left running in the background with nothing to say, so `lantern browse`
 * draws its board at the same moment it always did.
 *
 * Every failure is silence. An out-of-date Lantern still works, and a version
 * check is not worth a word of anybody's error output.
 */
export const maybeNotifyUpdate = async (
  argv: readonly string[],
  isInteractive: boolean,
  env: Record<string, string | undefined>,
  now: number,
): Promise<void> => {
  if (!wantsUpdateCheck(argv)) {
    return;
  }

  const source = await detectInstallSource().catch(() => null);
  if (source === null) {
    return;
  }

  // Settled before the settings file is opened at all: a container, a .deb, a
  // checkout and an npx run can do nothing with a notice, and the image starts
  // on every `docker run` — reading two files to decide to say nothing is two
  // files too many.
  if (!isInteractive || !isNotifiable(source.kind)) {
    return;
  }

  const [config, cache] = await Promise.all([
    runQuietly(readCliConfig, null),
    runQuietly<UpdateCache | null>(readUpdateCache, null),
  ]);

  const notifier = {
    isInteractive,
    env,
    configOptOut: config?.updateNotifier === false,
    installSource: source.kind,
  };

  if (isUpdateNotifierSilenced(notifier)) {
    return;
  }

  const notice = updateNotice(packageJson.version, cache?.latest ?? null, source.kind);
  if (notice !== null) {
    // stderr, so a notice never lands in output somebody is piping.
    process.stderr.write(`${notice}\n`);
  }

  if (
    shouldCheckForUpdate({
      ...notifier,
      lastCheckedAt: cache?.checkedAt ?? null,
      now,
      intervalMs: UPDATE_CHECK_INTERVAL_MS,
    })
  ) {
    void refreshCache(now);
  }
};

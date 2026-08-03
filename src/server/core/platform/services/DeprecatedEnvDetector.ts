import { Console, Effect } from "effect";
import { LEGACY_ENV_ALIASES } from "../legacyEnv.ts";

const getOptionalEnv = (key: string): string | undefined => {
  // biome-ignore lint/style/noProcessEnv: allow only here
  // oxlint-disable-next-line node/no-process-env -- configuration boundary
  return process.env[key] ?? undefined;
};

const detectDeprecatedEnvs = (): Array<readonly [string, string]> =>
  Object.entries(LEGACY_ENV_ALIASES).filter(
    ([legacyKey]) => getOptionalEnv(legacyKey) !== undefined,
  );

/**
 * Warns about environment variables carrying the project's former name. They
 * are still applied (see `withLegacyEnvAliases`), so this never blocks startup —
 * it only makes sure a deployment gets updated before support is dropped.
 */
export const checkDeprecatedEnvs = Effect.gen(function* () {
  const deprecated = detectDeprecatedEnvs();

  if (deprecated.length === 0) {
    return;
  }

  yield* Console.log("");
  yield* Console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  yield* Console.log("  Renamed environment variables");
  yield* Console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  yield* Console.log("");

  for (const [legacyKey, currentKey] of deprecated) {
    yield* Console.log(`⚠️  DEPRECATED: ${legacyKey} is now ${currentKey}.`);
    yield* Console.log(
      `   → Still applied for now. Rename it to ${currentKey} before the next major release.`,
    );
    yield* Console.log("");
  }

  yield* Console.log("For the full list of options, see:");
  yield* Console.log("  https://github.com/WildChildForLife/lantern#configuration");
  yield* Console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  yield* Console.log("");
});

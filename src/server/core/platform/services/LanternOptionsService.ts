import { Context, Effect, Layer, Ref } from "effect";
import type { InferEffect } from "../../../lib/effect/types.ts";
import { type SourceId, sourceIdSchema } from "../../source/models/SourceId.ts";
import { resolveBindHostname } from "../resolveBindHostname.ts";

export type CliOptions = {
  port: string;
  hostname: string;
  verbose?: boolean | undefined;
  password?: string | undefined;
  executable?: string | undefined;
  claudeDir?: string | undefined;
  terminalDisabled?: boolean | undefined;
  terminalShell?: string | undefined;
  terminalUnrestricted?: boolean | undefined;
  apiOnly?: boolean | undefined;
  source?: string[] | undefined;
};

/**
 * Settings persisted by `lantern init`, the tier between environment variables
 * and the built-in defaults.
 *
 * Structural on purpose: the wizard owns the file and its schema, and the
 * backend has no business depending on the CLI to read one tier of its own
 * options.
 */
export type StoredOptions = {
  port?: number | undefined;
  hostname?: string | undefined;
  claudeDir?: string | undefined;
  executable?: string | undefined;
  terminalDisabled?: boolean | undefined;
  terminalShell?: string | undefined;
  terminalUnrestricted?: boolean | undefined;
  apiOnly?: boolean | undefined;
};

export type LanternOptions = {
  port: number;
  hostname: string;
  verbose?: boolean | undefined;
  password?: string | undefined;
  executable?: string | undefined;
  claudeDir?: string | undefined;
  terminalDisabled?: boolean | undefined;
  terminalShell?: string | undefined;
  terminalUnrestricted?: boolean | undefined;
  apiOnly?: boolean | undefined;
  /** Sources named on the command line, overriding the stored selection. */
  sources?: SourceId[] | undefined;
};

const getOptionalEnv = (key: string): string | undefined => {
  // biome-ignore lint/style/noProcessEnv: allow only here
  // oxlint-disable-next-line node/no-process-env -- configuration boundary
  return process.env[key] ?? undefined;
};

const splitList = (value: string | undefined): string[] | undefined =>
  value === undefined || value === "" ? undefined : value.split(",");

/** Unknown ids are dropped with a warning rather than refusing to boot. */
const parseSources = (values: string[] | undefined): SourceId[] | undefined => {
  if (values === undefined) {
    return undefined;
  }

  const parsed = values
    .map((value) => sourceIdSchema.safeParse(value.trim()))
    .flatMap((result) => (result.success ? [result.data] : []));

  return parsed.length === 0 ? undefined : [...new Set(parsed)];
};

const isFlagEnabled = (value: string | undefined) => {
  if (value === undefined || value === "") return false;
  return value === "1" || value.toLowerCase() === "true";
};

/**
 * A flag-style environment variable only ever turns something *on* — an unset
 * or falsey one has to read as "not answered" so the tier below still gets a
 * say.
 */
const envFlag = (value: string | undefined): true | undefined =>
  isFlagEnabled(value) ? true : undefined;

/**
 * Resolves the options Lantern runs with: **CLI flag, then environment
 * variable, then stored settings, then the built-in default**.
 *
 * Stored settings sit below the environment so that a container or a shell
 * export still overrides what the wizard wrote on this machine.
 */
export const toLanternOptions = (
  cliOptions?: CliOptions,
  stored?: StoredOptions,
): LanternOptions => {
  return {
    port: Number.parseInt(
      cliOptions?.port ?? getOptionalEnv("PORT") ?? stored?.port?.toString() ?? "3000",
      10,
    ),
    hostname: resolveBindHostname(
      cliOptions?.hostname,
      getOptionalEnv("LANTERN_HOSTNAME") ?? stored?.hostname,
    ),
    verbose:
      cliOptions?.verbose ?? (isFlagEnabled(getOptionalEnv("LANTERN_VERBOSE")) ? true : undefined),
    password: cliOptions?.password ?? getOptionalEnv("LANTERN_PASSWORD") ?? undefined,
    executable:
      cliOptions?.executable ?? getOptionalEnv("LANTERN_CLAUDE_EXECUTABLE") ?? stored?.executable,
    claudeDir: cliOptions?.claudeDir ?? getOptionalEnv("LANTERN_CLAUDE_DIR") ?? stored?.claudeDir,
    terminalDisabled:
      cliOptions?.terminalDisabled ??
      envFlag(getOptionalEnv("LANTERN_TERMINAL_DISABLED")) ??
      stored?.terminalDisabled,
    terminalShell:
      cliOptions?.terminalShell ??
      getOptionalEnv("LANTERN_TERMINAL_SHELL") ??
      stored?.terminalShell,
    terminalUnrestricted:
      cliOptions?.terminalUnrestricted ??
      envFlag(getOptionalEnv("LANTERN_TERMINAL_UNRESTRICTED")) ??
      stored?.terminalUnrestricted,
    apiOnly: cliOptions?.apiOnly ?? envFlag(getOptionalEnv("LANTERN_API_ONLY")) ?? stored?.apiOnly,
    sources: parseSources(cliOptions?.source ?? splitList(getOptionalEnv("LANTERN_SOURCES"))),
  };
};

const makeService = (initial: LanternOptions) =>
  Effect.gen(function* () {
    const optionsRef = yield* Ref.make<LanternOptions>(initial);

    const loadCliOptions = (cliOptions: CliOptions, stored?: StoredOptions) => {
      return Effect.gen(function* () {
        yield* Ref.update(optionsRef, () => toLanternOptions(cliOptions, stored));
      });
    };

    const getOption = <K extends keyof LanternOptions>(key: K) => {
      return Effect.gen(function* () {
        const lanternOptions = yield* Ref.get(optionsRef);
        return lanternOptions[key];
      });
    };

    return {
      loadCliOptions,
      getOption,
    };
  });

const LayerImpl = makeService(toLanternOptions());

export type ILanternOptionsService = InferEffect<typeof LayerImpl>;

export class LanternOptionsService extends Context.Tag("LanternOptionsService")<
  LanternOptionsService,
  ILanternOptionsService
>() {
  static Live = Layer.effect(this, LayerImpl);

  /**
   * The same service, but already holding the answers.
   *
   * `Live` starts from the environment alone and expects `loadCliOptions` to
   * follow, which only works for services that read their options lazily, on
   * request. Anything that reads them while it is being *built* — the cache
   * location, a source's roots — would see the pre-flag values. A command that
   * knows its options up front provides this instead, and the whole graph is
   * constructed with them already in place.
   */
  static withOptions = (cliOptions: CliOptions, stored?: StoredOptions) =>
    Layer.effect(this, makeService(toLanternOptions(cliOptions, stored)));
}

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

const toLanternOptions = (cliOptions?: CliOptions): LanternOptions => {
  return {
    port: Number.parseInt(cliOptions?.port ?? getOptionalEnv("PORT") ?? "3000", 10),
    hostname: resolveBindHostname(cliOptions?.hostname, getOptionalEnv("LANTERN_HOSTNAME")),
    verbose:
      cliOptions?.verbose ?? (isFlagEnabled(getOptionalEnv("LANTERN_VERBOSE")) ? true : undefined),
    password: cliOptions?.password ?? getOptionalEnv("LANTERN_PASSWORD") ?? undefined,
    executable: cliOptions?.executable ?? getOptionalEnv("LANTERN_CLAUDE_EXECUTABLE") ?? undefined,
    claudeDir: cliOptions?.claudeDir ?? getOptionalEnv("LANTERN_CLAUDE_DIR"),
    terminalDisabled:
      cliOptions?.terminalDisabled ??
      (isFlagEnabled(getOptionalEnv("LANTERN_TERMINAL_DISABLED")) ? true : undefined),
    terminalShell:
      cliOptions?.terminalShell ?? getOptionalEnv("LANTERN_TERMINAL_SHELL") ?? undefined,
    terminalUnrestricted:
      cliOptions?.terminalUnrestricted ??
      (isFlagEnabled(getOptionalEnv("LANTERN_TERMINAL_UNRESTRICTED")) ? true : undefined),
    apiOnly:
      cliOptions?.apiOnly ?? (isFlagEnabled(getOptionalEnv("LANTERN_API_ONLY")) ? true : undefined),
    sources: parseSources(cliOptions?.source ?? splitList(getOptionalEnv("LANTERN_SOURCES"))),
  };
};

const LayerImpl = Effect.gen(function* () {
  const optionsRef = yield* Ref.make<LanternOptions>(toLanternOptions());

  const loadCliOptions = (cliOptions: CliOptions) => {
    return Effect.gen(function* () {
      yield* Ref.update(optionsRef, () => toLanternOptions(cliOptions));
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

export type ILanternOptionsService = InferEffect<typeof LayerImpl>;

export class LanternOptionsService extends Context.Tag("LanternOptionsService")<
  LanternOptionsService,
  ILanternOptionsService
>() {
  static Live = Layer.effect(this, LayerImpl);
}

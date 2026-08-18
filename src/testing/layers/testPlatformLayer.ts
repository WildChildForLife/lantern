import { Path } from "@effect/platform";
import { Effect, Layer } from "effect";
import { DEFAULT_LOCALE } from "../../lib/i18n/localeDetection";
import { EventBus } from "../../server/core/events/services/EventBus";
import type { EnvSchema } from "../../server/core/platform/schema";
import {
  ApplicationContext,
  type ClaudeCodePaths,
} from "../../server/core/platform/services/ApplicationContext";
import { EnvService } from "../../server/core/platform/services/EnvService";
import {
  type LanternOptions,
  LanternOptionsService,
} from "../../server/core/platform/services/LanternOptionsService";
import { UserConfigService } from "../../server/core/platform/services/UserConfigService";
import type { SourceId } from "../../server/core/source/models/SourceId";
import type { UserConfig } from "../../server/lib/config/config";

const claudeDirForTest = `${process.cwd()}/fixtures/claude-home`;

export const testPlatformLayer = (overrides?: {
  claudeCodePaths?: Partial<ClaudeCodePaths>;
  env?: Partial<EnvSchema>;
  userConfig?: Partial<UserConfig>;
  lanternOptions?: Partial<LanternOptions>;
  platform?: NodeJS.Platform;
  sourceRoots?: Partial<Record<SourceId, string>>;
}) => {
  const applicationContextLayer = Layer.mock(ApplicationContext, {
    claudeCodePaths: Effect.succeed({
      globalClaudeDirectoryPath: claudeDirForTest,
      claudeCommandsDirPath: `${claudeDirForTest}/commands`,
      claudeSkillsDirPath: `${claudeDirForTest}/skills`,
      claudeAgentsDirPath: `${claudeDirForTest}/agents`,
      claudeProjectsDirPath: `${claudeDirForTest}/projects`,
      ...overrides?.claudeCodePaths,
    }),
    homeDirectory: Effect.succeed(overrides?.env?.HOME ?? process.cwd()),
    platform: overrides?.platform ?? process.platform,
    // Every adapter reads its root through this, so a test can point one at a
    // fixture tree and no test can wander into the developer's real history.
    sourceRoot: (sourceId) => Effect.succeed(overrides?.sourceRoots?.[sourceId]),
  });

  const optionsServiceLayer = Layer.mock(LanternOptionsService, {
    getOption: <Key extends keyof LanternOptions>(key: Key) =>
      Effect.sync((): LanternOptions[Key] => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test mock returns partial overrides, the cast is safe in test context
        return overrides?.lanternOptions?.[key] as LanternOptions[Key];
      }),
  });

  const envServiceLayer = Layer.mock(EnvService, {
    getEnv: <Key extends keyof EnvSchema>(key: Key) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test mock with generic key requires cast for return type
      Effect.sync(() => {
        switch (key) {
          case "LANTERN_ENV":
            return overrides?.env?.LANTERN_ENV ?? "development";
          case "HOME":
            return overrides?.env?.HOME ?? process.cwd();
          // Left unset by default: HOME already answers on the platforms tests
          // run on, and defaulting both would hide which one a test is exercising.
          case "USERPROFILE":
            return overrides?.env?.USERPROFILE ?? undefined;
          case "LANTERN_HOSTNAME":
            return overrides?.env?.LANTERN_HOSTNAME ?? undefined;
          // Unset unless a test says otherwise: a real key in the ambient
          // environment must never make billing detection look metered here.
          case "ANTHROPIC_API_KEY":
            return overrides?.env?.ANTHROPIC_API_KEY ?? undefined;
          case "ANTHROPIC_AUTH_TOKEN":
            return overrides?.env?.ANTHROPIC_AUTH_TOKEN ?? undefined;
          case "LANTERN_PASSWORD":
            return overrides?.env?.LANTERN_PASSWORD ?? undefined;
          case "PATH":
            return overrides?.env?.PATH ?? undefined;
          case "SHELL":
            return overrides?.env?.SHELL ?? undefined;
          case "LANTERN_TERMINAL_SHELL":
            return overrides?.env?.LANTERN_TERMINAL_SHELL ?? undefined;
          case "LANTERN_TERMINAL_UNRESTRICTED":
            return overrides?.env?.LANTERN_TERMINAL_UNRESTRICTED ?? undefined;
          case "CODEX_HOME":
            return overrides?.env?.CODEX_HOME ?? undefined;
          case "XDG_DATA_HOME":
            return overrides?.env?.XDG_DATA_HOME ?? undefined;
          // Where the node version managers keep their installs, which is where
          // a `claude` that PATH does not carry is looked for.
          case "NVM_DIR":
            return overrides?.env?.NVM_DIR ?? undefined;
          case "FNM_DIR":
            return overrides?.env?.FNM_DIR ?? undefined;
          case "VOLTA_HOME":
            return overrides?.env?.VOLTA_HOME ?? undefined;
          case "PNPM_HOME":
            return overrides?.env?.PNPM_HOME ?? undefined;
          case "APPDATA":
            return overrides?.env?.APPDATA ?? undefined;
          case "LANTERN_TERMINAL_DISABLED":
            return overrides?.env?.LANTERN_TERMINAL_DISABLED ?? undefined;
          default:
            return undefined;
        }
      }) as Effect.Effect<EnvSchema[Key]>,
  });

  const userConfigServiceLayer = Layer.mock(UserConfigService, {
    setUserConfig: () => Effect.succeed(undefined),
    getUserConfig: () =>
      Effect.succeed<UserConfig>({
        hideNoUserMessageSession: overrides?.userConfig?.hideNoUserMessageSession ?? true,
        unifySameTitleSession: overrides?.userConfig?.unifySameTitleSession ?? true,
        enterKeyBehavior: overrides?.userConfig?.enterKeyBehavior ?? "shift-enter-send",
        locale: overrides?.userConfig?.locale ?? DEFAULT_LOCALE,
        theme: overrides?.userConfig?.theme ?? "system",
        searchHotkey: overrides?.userConfig?.searchHotkey ?? "command-k",
        findHotkey: overrides?.userConfig?.findHotkey ?? "command-f",
        autoScheduleContinueOnRateLimit:
          overrides?.userConfig?.autoScheduleContinueOnRateLimit ?? false,
        showTechnicalDetails: overrides?.userConfig?.showTechnicalDetails ?? false,
        modelChoices: overrides?.userConfig?.modelChoices ?? ["default", "haiku", "sonnet", "opus"],
      }),
  });

  return Layer.mergeAll(
    applicationContextLayer,
    userConfigServiceLayer,
    EventBus.Live,
    optionsServiceLayer,
    envServiceLayer,
    Path.layer,
  );
};

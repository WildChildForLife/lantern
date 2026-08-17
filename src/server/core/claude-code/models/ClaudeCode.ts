import * as agentSdk from "@anthropic-ai/claude-agent-sdk";
import { Command, FileSystem, Path } from "@effect/platform";
import { Data, Effect, Option } from "effect";
import { uniq } from "es-toolkit";
import { ApplicationContext } from "../../platform/services/ApplicationContext.ts";
import { EnvService } from "../../platform/services/EnvService.ts";
import { LanternOptionsService } from "../../platform/services/LanternOptionsService.ts";
import {
  claudeInstallLocations,
  versionRootCandidates,
} from "../functions/claudeInstallLocations.ts";
import * as ClaudeCodeVersion from "./ClaudeCodeVersion.ts";

type AgentSdkQuery = typeof agentSdk.query;
type AgentSdkPrompt = Parameters<AgentSdkQuery>[0]["prompt"];
type AgentSdkQueryOptions = NonNullable<Parameters<AgentSdkQuery>[0]["options"]>;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const npxCacheRegExp = /_npx[/\\].*node_modules[\\/]\.bin/;
const localNodeModulesBinRegExp = new RegExp(
  `${escapeRegExp(process.cwd())}[/\\\\]node_modules[/\\\\]\\.bin(?:[/\\\\]|$)`,
);

export const claudeCodePathPriority = (path: string): number => {
  if (npxCacheRegExp.test(path)) {
    return 0;
  }

  if (localNodeModulesBinRegExp.test(path)) {
    return 1;
  }

  return 2;
};

class ClaudeCodePathNotFoundError extends Data.TaggedError("ClaudeCodePathNotFoundError")<{
  message: string;
}> {}

class ClaudeCodeAgentSdkNotSupportedError extends Data.TaggedError(
  "ClaudeCodeAgentSdkNotSupportedError",
)<{
  message: string;
}> {}

/**
 * The known install directories, searched when PATH came back empty.
 *
 * Reading a handful of directories is cheap and only ever happens once PATH has
 * already failed, which on a machine where `which claude` works is never.
 */
const searchInstalledClaudePaths = Effect.gen(function* () {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const context = yield* ApplicationContext;
  const envService = yield* EnvService;

  const join = (...segments: string[]) => path.join(...segments);

  const locations = claudeInstallLocations(
    {
      home: yield* context.homeDirectory,
      platform: context.platform,
      nvmDir: yield* envService.getEnv("NVM_DIR"),
      fnmDir: yield* envService.getEnv("FNM_DIR"),
      voltaHome: yield* envService.getEnv("VOLTA_HOME"),
      pnpmHome: yield* envService.getEnv("PNPM_HOME"),
      xdgDataHome: yield* envService.getEnv("XDG_DATA_HOME"),
      appData: yield* envService.getEnv("APPDATA"),
    },
    join,
  );

  // A directory that is not there, or that this user may not read, is an
  // absence like any other — never a reason to fail the whole lookup.
  const exists = (candidate: string) =>
    fs.exists(candidate).pipe(Effect.catchAll(() => Effect.succeed(false)));

  const fromVersionRoots = yield* Effect.forEach(locations.versionRoots, (root) =>
    fs.readDirectory(root.dir).pipe(
      Effect.map((versions) => versionRootCandidates(root, versions, context.platform, join)),
      Effect.catchAll(() => Effect.succeed<readonly string[]>([])),
    ),
  );

  const candidates = [...locations.files, ...fromVersionRoots.flat()];

  return {
    candidates,
    found: Option.getOrUndefined(yield* Effect.findFirst(candidates, exists)),
  };
});

export const resolveClaudeCodePath = Effect.gen(function* () {
  const path = yield* Path.Path;
  const optionsService = yield* LanternOptionsService;

  // Environment variable (highest priority)
  const specifiedExecutablePath = yield* optionsService.getOption("executable");
  if (specifiedExecutablePath !== undefined) {
    return path.resolve(specifiedExecutablePath);
  }

  // System PATH lookup (`where` on Windows, `which -a` elsewhere — both list every match, one per line)
  const lookupCommand =
    process.platform === "win32"
      ? Command.make("where", "claude")
      : Command.make("which", "-a", "claude");
  const claudePaths = yield* Command.string(lookupCommand).pipe(
    Effect.map(
      (output) =>
        output
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== "")
          .map((line) => (path.isAbsolute(line) ? line : path.resolve(line))) ?? [],
    ),
    Effect.map((paths) =>
      uniq(paths).toSorted((a, b) => {
        const aPriority = claudeCodePathPriority(a);
        const bPriority = claudeCodePathPriority(b);

        if (aPriority < bPriority) {
          return 1;
        }
        if (aPriority > bPriority) {
          return -1;
        }

        return 0;
      }),
    ),
    Effect.catchAll(() => Effect.succeed<string[]>([])),
  );

  const resolvedClaudePath = claudePaths.at(0);
  if (resolvedClaudePath !== undefined) {
    return resolvedClaudePath;
  }

  // PATH is not the whole machine. Claude Code is normally installed under one
  // node version and Lantern needs another, so the version manager that keeps
  // them apart is exactly what takes `claude` off PATH here while leaving it
  // installed and runnable — see `claudeInstallLocations`.
  const installed = yield* searchInstalledClaudePaths;
  if (installed.found !== undefined) {
    yield* Effect.logInfo(
      `[ClaudeCode] not on PATH; using the installed copy at ${installed.found}`,
    );
    return installed.found;
  }

  // Where it looked belongs in the log, not in the message: the message is
  // read off a status bar one line high, and a list of twenty paths there says
  // less than the one thing the user can do about it.
  yield* Effect.logDebug(`[ClaudeCode] looked in: ${installed.candidates.join(", ")}`);

  return yield* Effect.fail(
    new ClaudeCodePathNotFoundError({
      message: "Claude Code CLI not found - pass --executable /path/to/claude",
    }),
  );
});

export const Config = Effect.gen(function* () {
  const claudeCodeExecutablePath = yield* resolveClaudeCodePath;

  const claudeCodeVersion = ClaudeCodeVersion.fromCLIString(
    yield* Command.string(Command.make(claudeCodeExecutablePath, "--version")),
  );

  return {
    claudeCodeExecutablePath,
    claudeCodeVersion,
  };
});

export const getMcpListOutput = (projectCwd: string) =>
  Effect.gen(function* () {
    const { claudeCodeExecutablePath } = yield* Config;
    const output = yield* Command.string(
      Command.make(claudeCodeExecutablePath, "mcp", "list").pipe(
        Command.workingDirectory(projectCwd),
      ),
    );
    return output;
  });

export const getAvailableFeatures = (
  claudeCodeVersion: ClaudeCodeVersion.ClaudeCodeVersion | null,
) => ({
  canUseTool:
    claudeCodeVersion !== null
      ? ClaudeCodeVersion.greaterThanOrEqual(claudeCodeVersion, {
          major: 1,
          minor: 0,
          patch: 82,
        })
      : false,
  uuidOnSDKMessage:
    claudeCodeVersion !== null
      ? ClaudeCodeVersion.greaterThanOrEqual(claudeCodeVersion, {
          major: 1,
          minor: 0,
          patch: 86,
        })
      : false,
  agentSdk:
    claudeCodeVersion !== null
      ? ClaudeCodeVersion.greaterThanOrEqual(claudeCodeVersion, {
          major: 1,
          minor: 0,
          patch: 125, // ClaudeCodeAgentSDK is available since v1.0.125
        })
      : false,
  sidechainSeparation:
    claudeCodeVersion !== null
      ? ClaudeCodeVersion.greaterThanOrEqual(claudeCodeVersion, {
          major: 2,
          minor: 0,
          patch: 28, // Sidechain conversations stored in agent-*.jsonl since v2.0.28
        })
      : false,
  runSkillsDirectly:
    claudeCodeVersion !== null
      ? ClaudeCodeVersion.greaterThanOrEqual(claudeCodeVersion, {
          major: 2,
          minor: 1,
          patch: 0,
        }) ||
        ClaudeCodeVersion.greaterThanOrEqual(claudeCodeVersion, {
          major: 2,
          minor: 0,
          patch: 77,
        })
      : false,
});

export const query = (prompt: AgentSdkPrompt, options: AgentSdkQueryOptions) => {
  const {
    canUseTool,
    permissionMode,
    hooks: _hooks,
    systemPrompt,
    settingSources,
    ...baseOptions
  } = options;

  return Effect.gen(function* () {
    const { claudeCodeExecutablePath, claudeCodeVersion } = yield* Config;
    const availableFeatures = getAvailableFeatures(claudeCodeVersion);

    const options: AgentSdkQueryOptions = {
      ...baseOptions,
      ...(systemPrompt !== undefined ? { systemPrompt } : {}),
      ...(settingSources !== undefined ? { settingSources } : {}),
      pathToClaudeCodeExecutable: claudeCodeExecutablePath,
      disallowedTools: ["AskUserQuestion", ...(baseOptions.disallowedTools ?? [])], // Cannot answer from web interface instead of CLI
      ...(availableFeatures.canUseTool
        ? { canUseTool, permissionMode }
        : {
            permissionMode: "bypassPermissions",
          }),
    };

    if (!availableFeatures.agentSdk) {
      return yield* new ClaudeCodeAgentSdkNotSupportedError({
        message: "Agent SDK is not supported in this version of Claude Code",
      });
    }

    return agentSdk.query({
      prompt,
      options: {
        settingSources: ["user", "project", "local"],
        ...options,
      },
    });
  });
};

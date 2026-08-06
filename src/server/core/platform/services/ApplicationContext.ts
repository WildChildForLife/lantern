import { Path } from "@effect/platform";
import { Effect, Context as EffectContext, Layer } from "effect";
import type { InferEffect } from "../../../lib/effect/types.ts";
import {
  CODEX_SOURCE_ID,
  GOOSE_SOURCE_ID,
  OPENCODE_SOURCE_ID,
  type SourceId,
} from "../../source/models/SourceId.ts";
import { resolveHomeDirectory } from "../resolveHomeDirectory.ts";
import { EnvService } from "./EnvService.ts";
import { LanternOptionsService } from "./LanternOptionsService.ts";

export type ClaudeCodePaths = {
  globalClaudeDirectoryPath: string;
  claudeCommandsDirPath: string;
  claudeSkillsDirPath: string;
  claudeAgentsDirPath: string;
  claudeProjectsDirPath: string;
};

const LayerImpl = Effect.gen(function* () {
  const path = yield* Path.Path;
  const optionsService = yield* LanternOptionsService;
  const envService = yield* EnvService;

  /** `HOME`, or `USERPROFILE` on the Windows shells that set only that. */
  const resolvedHomeDirectory = Effect.all([
    envService.getEnv("HOME"),
    envService.getEnv("USERPROFILE"),
  ]).pipe(Effect.map(([home, userProfile]) => resolveHomeDirectory(home, userProfile)));

  const claudeCodePaths = Effect.gen(function* () {
    const cliClaudeDir = yield* optionsService.getOption("claudeDir");
    const homeDirectory = yield* resolvedHomeDirectory;
    const globalClaudeDirectoryPath =
      cliClaudeDir === undefined
        ? path.resolve(homeDirectory ?? "/", ".claude")
        : path.resolve(cliClaudeDir);

    return {
      globalClaudeDirectoryPath,
      claudeCommandsDirPath: path.resolve(globalClaudeDirectoryPath, "commands"),
      claudeSkillsDirPath: path.resolve(globalClaudeDirectoryPath, "skills"),
      claudeAgentsDirPath: path.resolve(globalClaudeDirectoryPath, "agents"),
      claudeProjectsDirPath: path.resolve(globalClaudeDirectoryPath, "projects"),
    } as const satisfies ClaudeCodePaths;
  });

  /**
   * The user's home directory.
   *
   * Not derivable from `globalClaudeDirectoryPath`: `--claude-dir` can point
   * anywhere, and its parent is then an unrelated directory.
   */
  const homeDirectory = resolvedHomeDirectory;

  /**
   * Read here rather than at each call site, so a test can drive the rules of a
   * platform it is not running on — path case-folding above all.
   */
  const platform: NodeJS.Platform = process.platform;

  /**
   * Where a source keeps its history, when it is not the default.
   *
   * Read from the environment variable the CLI itself honours, so pointing
   * Lantern at another machine's history is the same gesture as pointing that
   * CLI at it.
   *
   * Claude Code is absent on purpose: `--claude-dir` names the whole `.claude`
   * directory, not a history root, and its adapter reads `claudeCodePaths`.
   * Answering with it here would have handed out a path one level too high.
   */
  /**
   * A CLI with no home of its own, sitting under the XDG data directory: the
   * variable that moves it is the one that moves everything there.
   *
   * Empty means "use the default" under the XDG spec, not "the current
   * directory" — which is what joining onto it would produce.
   */
  const xdgDataChild = (name: string): Effect.Effect<string | undefined> =>
    envService
      .getEnv("XDG_DATA_HOME")
      .pipe(
        Effect.map((dataHome) =>
          dataHome === undefined || dataHome === "" ? undefined : path.join(dataHome, name),
        ),
      );

  const sourceRoot = (sourceId: SourceId): Effect.Effect<string | undefined> => {
    if (sourceId === CODEX_SOURCE_ID) {
      return envService.getEnv("CODEX_HOME");
    }

    if (sourceId === OPENCODE_SOURCE_ID) {
      return xdgDataChild("opencode");
    }

    if (sourceId === GOOSE_SOURCE_ID) {
      return xdgDataChild("goose");
    }

    return Effect.succeed(undefined);
  };

  return {
    claudeCodePaths,
    homeDirectory,
    platform,
    sourceRoot,
  };
});

export type IApplicationContext = InferEffect<typeof LayerImpl>;
export class ApplicationContext extends EffectContext.Tag("ApplicationContext")<
  ApplicationContext,
  IApplicationContext
>() {
  static Live = Layer.effect(this, LayerImpl);
}

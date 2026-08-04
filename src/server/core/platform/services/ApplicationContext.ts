import { Path } from "@effect/platform";
import { Effect, Context as EffectContext, Layer } from "effect";
import type { InferEffect } from "../../../lib/effect/types.ts";
import { CODEX_SOURCE_ID, type SourceId } from "../../source/models/SourceId.ts";
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

  const claudeCodePaths = Effect.gen(function* () {
    const cliClaudeDir = yield* optionsService.getOption("claudeDir");
    const homeDirectory = yield* envService.getEnv("HOME");
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
  const homeDirectory = envService.getEnv("HOME");

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
  const sourceRoot = (sourceId: SourceId): Effect.Effect<string | undefined> =>
    sourceId === CODEX_SOURCE_ID ? envService.getEnv("CODEX_HOME") : Effect.succeed(undefined);

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

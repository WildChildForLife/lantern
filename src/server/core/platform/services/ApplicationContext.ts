import { Path } from "@effect/platform";
import { Effect, Context as EffectContext, Layer } from "effect";
import type { InferEffect } from "../../../lib/effect/types.ts";
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

  return {
    claudeCodePaths,
    homeDirectory,
    platform,
  };
});

export type IApplicationContext = InferEffect<typeof LayerImpl>;
export class ApplicationContext extends EffectContext.Tag("ApplicationContext")<
  ApplicationContext,
  IApplicationContext
>() {
  static Live = Layer.effect(this, LayerImpl);
}

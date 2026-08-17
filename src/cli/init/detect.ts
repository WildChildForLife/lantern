import { FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { resolveClaudeCodePath } from "../../server/core/claude-code/models/ClaudeCode.ts";
import { ApplicationContext } from "../../server/core/platform/services/ApplicationContext.ts";
import { EnvService } from "../../server/core/platform/services/EnvService.ts";
import { isEnvValueSet } from "../../server/core/platform/services/LanternOptionsService.ts";
import type { SourceId } from "../../server/core/source/models/SourceId.ts";
import { ALL_SOURCE_ADAPTERS } from "../../server/core/source/services/SourceRegistry.ts";
import { cliPlatformLayer } from "../platformLayer.ts";

export type DetectedSource = {
  id: SourceId;
  displayName: string;
  /** Where its history lives, or null if nothing was found. */
  rootPath: string | null;
  /** A real session was read and parsed here, not merely a directory found. */
  usable: boolean;
};

export type Detection = {
  sources: DetectedSource[];
  claudeDirectory: string;
  /** Path of the `claude` binary, or null when it is not on this machine. */
  executable: string | null;
  /** Whether the in-app terminal's PTY binary exists for this platform. */
  terminalAvailable: boolean;
  /**
   * Whether `LANTERN_PASSWORD` is already set here.
   *
   * The wizard refuses to write a password down, so this is the only way it can
   * tell whether a non-loopback bind would actually be protected.
   */
  passwordSet: boolean;
};

/**
 * Whether `@replit/ruspty` has a prebuilt binary here.
 *
 * The same check the server makes before offering the in-app terminal; asking
 * it now means the wizard defaults the answer to what actually works rather
 * than to "on".
 */
const detectTerminalSupport = Effect.tryPromise({
  try: async () => {
    await import("@replit/ruspty");
    return true;
  },
  catch: () => false,
}).pipe(Effect.catchAll(() => Effect.succeed(false)));

/**
 * Everything the wizard can work out for itself.
 *
 * Every question is then pre-filled with the answer, so setup is a series of
 * confirmations rather than a series of paths to remember.
 */
export const detectEnvironment = (claudeDir?: string): Promise<Detection> => {
  const program = Effect.gen(function* () {
    const context = yield* ApplicationContext;
    const envService = yield* EnvService;
    const paths = yield* context.claudeCodePaths;

    const sources = yield* Effect.forEach(ALL_SOURCE_ADAPTERS, (adapter) =>
      adapter.detect().pipe(
        Effect.map((detection): DetectedSource => ({
          id: adapter.id,
          displayName: adapter.displayName,
          rootPath: detection.rootPath,
          usable: detection.hasData && detection.supported,
        })),
      ),
    );

    const executable = yield* resolveClaudeCodePath.pipe(
      Effect.map((resolved): string | null => resolved),
      // Not having Claude Code installed is an answer, not a failure: the
      // other five sources are read without it.
      Effect.catchAll(() => Effect.succeed(null)),
    );

    return {
      sources,
      claudeDirectory: paths.globalClaudeDirectoryPath,
      executable,
      terminalAvailable: yield* detectTerminalSupport,
      // The same rule the server resolves options by: an exported-but-empty
      // variable is not a password, and calling it one is how the wizard used to
      // green-light an open bind with no authentication behind it.
      passwordSet: isEnvValueSet(yield* envService.getEnv("LANTERN_PASSWORD")),
    };
  });

  const detectLayer = Layer.mergeAll(cliPlatformLayer({ claudeDir }, {}), NodeContext.layer);

  return Effect.runPromise(program.pipe(Effect.provide(detectLayer), Effect.scoped));
};

/** Whether a path exists and holds a `projects` directory, for the claude dir step. */
export const looksLikeClaudeDirectory = (candidate: string): Promise<boolean> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      return yield* fs.exists(path.join(path.resolve(candidate), "projects"));
    }).pipe(
      Effect.catchAll(() => Effect.succeed(false)),
      Effect.provide(NodeContext.layer),
    ),
  );

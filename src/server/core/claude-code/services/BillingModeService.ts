import { FileSystem, Path } from "@effect/platform";
import { Context, Effect, Layer } from "effect";
import { z } from "zod";
import type { InferEffect } from "../../../lib/effect/types.ts";
import { ApplicationContext } from "../../platform/services/ApplicationContext.ts";
import { EnvService } from "../../platform/services/EnvService.ts";
import { type BillingDetection, detectBillingMode } from "../functions/detectBillingMode.ts";

/**
 * Only the one field is described. The rest of the file is access and refresh
 * tokens, and a shape that does not mention them cannot carry them out by
 * accident.
 */
const credentialsSchema = z.object({
  claudeAiOauth: z
    .object({
      subscriptionType: z.string().optional(),
    })
    .loose()
    .optional(),
});

const settingsSchema = z.object({
  apiKeyHelper: z.string().optional(),
});

const readJson = <A>(filePath: string, schema: z.ZodType<A>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const content = yield* fs
      .readFileString(filePath)
      .pipe(Effect.catchAll(() => Effect.succeed("")));

    if (content === "") {
      return null;
    }

    const parsed = schema.safeParse(
      yield* Effect.try({ try: (): unknown => JSON.parse(content), catch: () => null }).pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      ),
    );

    return parsed.success ? parsed.data : null;
  });

const LayerImpl = Effect.gen(function* () {
  const path = yield* Path.Path;
  const context = yield* ApplicationContext;
  const envService = yield* EnvService;

  /**
   * What the machine says about how Claude Code is billed.
   *
   * Recomputed per call rather than cached: someone can sign in, or export a
   * key, while Lantern is running, and a stale answer here would put wrong
   * money on the screen.
   */
  const detect: Effect.Effect<BillingDetection, never, FileSystem.FileSystem> = Effect.gen(
    function* () {
      const claudeDirectory = (yield* context.claudeCodePaths).globalClaudeDirectoryPath;

      const credentials = yield* readJson(
        path.join(claudeDirectory, ".credentials.json"),
        credentialsSchema,
      );
      const settings = yield* readJson(path.join(claudeDirectory, "settings.json"), settingsSchema);

      return detectBillingMode({
        apiKeyEnv: yield* envService.getEnv("ANTHROPIC_API_KEY"),
        authTokenEnv: yield* envService.getEnv("ANTHROPIC_AUTH_TOKEN"),
        hasApiKeyHelper: settings?.apiKeyHelper !== undefined && settings.apiKeyHelper !== "",
        subscriptionType: credentials?.claudeAiOauth?.subscriptionType ?? null,
      });
    },
  );

  return { detect };
});

export type IBillingModeService = InferEffect<typeof LayerImpl>;

export class BillingModeService extends Context.Tag("BillingModeService")<
  BillingModeService,
  IBillingModeService
>() {
  static Live = Layer.effect(this, LayerImpl);
}

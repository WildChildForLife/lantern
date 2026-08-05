import { NodeContext } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe, expect } from "vitest";
import {
  CODEX_SOURCE_ID,
  GOOSE_SOURCE_ID,
  OPENCODE_SOURCE_ID,
} from "../../source/models/SourceId.ts";
import type { EnvSchema } from "../schema.ts";
import { ApplicationContext } from "./ApplicationContext.ts";
import { EnvService } from "./EnvService.ts";
import { type LanternOptions, LanternOptionsService } from "./LanternOptionsService.ts";

/**
 * The real `sourceRoot`, not the test layer's stand-in.
 *
 * `testPlatformLayer` mocks `sourceRoot` with a lookup table, so every adapter
 * test injects its root and none of them reach this code. goose shipped
 * documenting `XDG_DATA_HOME` while ignoring it, and nothing caught that
 * because nothing exercised the real implementation.
 */
const contextWith = (env: Omit<Partial<EnvSchema>, "LANTERN_ENV">) => {
  const environment: EnvSchema = { LANTERN_ENV: "test", ...env };
  // Only `claudeDir` is read here, and it is absent on purpose: the point is
  // the environment, not the flag that overrides it.
  const options: LanternOptions = { port: 3400, hostname: "127.0.0.1" };

  return ApplicationContext.Live.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(EnvService, {
          getEnv: <Key extends keyof EnvSchema>(key: Key) => Effect.succeed(environment[key]),
        }),
        Layer.mock(LanternOptionsService, {
          getOption: <Key extends keyof LanternOptions>(key: Key) => Effect.succeed(options[key]),
        }),
        NodeContext.layer,
      ),
    ),
    Layer.provideMerge(NodeContext.layer),
  );
};

describe("ApplicationContext.sourceRoot", () => {
  it.live("moves goose with XDG_DATA_HOME, the variable goose itself honours", () =>
    Effect.gen(function* () {
      const context = yield* ApplicationContext;

      expect(yield* context.sourceRoot(GOOSE_SOURCE_ID)).toBe("/home/demo/.data/goose");
      expect(yield* context.sourceRoot(OPENCODE_SOURCE_ID)).toBe("/home/demo/.data/opencode");
    }).pipe(Effect.provide(contextWith({ HOME: "/home/demo", XDG_DATA_HOME: "/home/demo/.data" }))),
  );

  it.live("leaves the default to the adapter when XDG_DATA_HOME is unset or empty", () =>
    Effect.gen(function* () {
      const context = yield* ApplicationContext;

      // Empty means "use the default" under the XDG spec, not "the current
      // directory" — which is what joining onto it would produce.
      expect(yield* context.sourceRoot(GOOSE_SOURCE_ID)).toBeUndefined();
      expect(yield* context.sourceRoot(OPENCODE_SOURCE_ID)).toBeUndefined();
    }).pipe(Effect.provide(contextWith({ HOME: "/home/demo", XDG_DATA_HOME: "" }))),
  );

  it.live("moves Codex with CODEX_HOME, which names the directory outright", () =>
    Effect.gen(function* () {
      const context = yield* ApplicationContext;

      expect(yield* context.sourceRoot(CODEX_SOURCE_ID)).toBe("/elsewhere/codex");
    }).pipe(Effect.provide(contextWith({ HOME: "/home/demo", CODEX_HOME: "/elsewhere/codex" }))),
  );
});

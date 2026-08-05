import { describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vitest";
import { LanternOptionsService } from "./LanternOptionsService.ts";

describe("LanternOptionsService", () => {
  it.live("returns options before CLI options are loaded", () =>
    Effect.gen(function* () {
      const optionsService = yield* LanternOptionsService;
      const port = yield* optionsService.getOption("port");
      const hostname = yield* optionsService.getOption("hostname");

      expect(Number.isFinite(port)).toBe(true);
      expect(hostname.length).toBeGreaterThan(0);
    }).pipe(Effect.provide(LanternOptionsService.Live)),
  );

  it.live("loads verbose option from CLI", () =>
    Effect.gen(function* () {
      const optionsService = yield* LanternOptionsService;

      yield* optionsService.loadCliOptions({
        port: "3000",
        hostname: "localhost",
        verbose: true,
      });

      const verbose = yield* optionsService.getOption("verbose");
      expect(verbose).toBe(true);
    }).pipe(Effect.provide(LanternOptionsService.Live)),
  );

  it.live("defaults verbose option to undefined", () =>
    Effect.gen(function* () {
      const optionsService = yield* LanternOptionsService;

      yield* optionsService.loadCliOptions({
        port: "3000",
        hostname: "localhost",
      });

      const verbose = yield* optionsService.getOption("verbose");
      expect(verbose).toBeUndefined();
    }).pipe(Effect.provide(LanternOptionsService.Live)),
  );
});

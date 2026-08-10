import { describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterEach, expect, vi } from "vitest";
import { isEnvValueSet, LanternOptionsService, toLanternOptions } from "./LanternOptionsService.ts";

/**
 * One rule, shared with the `init` wizard.
 *
 * The wizard asked this question its own way and got a different answer: it
 * treated `export LANTERN_PASSWORD=` as a password, and so told the user that
 * binding to `0.0.0.0` was protected when nothing was protecting it.
 */
describe("isEnvValueSet", () => {
  it("counts a value as set", () => {
    expect(isEnvValueSet("hunter2")).toBe(true);
    expect(isEnvValueSet(" ")).toBe(true);
  });

  it("does not count an unset variable", () => {
    expect(isEnvValueSet(undefined)).toBe(false);
  });

  /** `export FOO=` is how a profile clears a variable, not how it answers. */
  it("does not count an exported-but-empty variable", () => {
    expect(isEnvValueSet("")).toBe(false);
  });
});

/**
 * The wizard writes settings that must lose to anything the operator says at
 * launch time — a container's `PORT`, or a flag typed on the spot.
 */
describe("toLanternOptions precedence", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses stored settings when nothing else answers", () => {
    const options = toLanternOptions(undefined, {
      port: 3400,
      hostname: "0.0.0.0",
      claudeDir: "/srv/claude",
      executable: "/usr/local/bin/claude",
      terminalDisabled: true,
      terminalShell: "/bin/zsh",
      terminalUnrestricted: true,
      apiOnly: true,
    });

    expect(options.port).toBe(3400);
    expect(options.hostname).toBe("0.0.0.0");
    expect(options.claudeDir).toBe("/srv/claude");
    expect(options.executable).toBe("/usr/local/bin/claude");
    expect(options.terminalDisabled).toBe(true);
    expect(options.terminalShell).toBe("/bin/zsh");
    expect(options.terminalUnrestricted).toBe(true);
    expect(options.apiOnly).toBe(true);
  });

  it("lets an environment variable beat stored settings", () => {
    vi.stubEnv("PORT", "4100");
    vi.stubEnv("LANTERN_CLAUDE_DIR", "/from/env");

    const options = toLanternOptions(undefined, { port: 3400, claudeDir: "/from/file" });

    expect(options.port).toBe(4100);
    expect(options.claudeDir).toBe("/from/env");
  });

  it("lets a command line flag beat both", () => {
    vi.stubEnv("PORT", "4100");

    const options = toLanternOptions({ port: "5200", hostname: "::1" }, { port: 3400 });

    expect(options.port).toBe(5200);
    expect(options.hostname).toBe("::1");
  });

  it("falls back to the built-in default when nothing is stored", () => {
    expect(toLanternOptions(undefined, {}).port).toBe(3000);
  });

  /**
   * `LANTERN_TERMINAL_DISABLED=false` means "not answered here", not "answered
   * no" — otherwise an unset variable would silently override the file.
   */
  it("does not let a falsey flag variable override a stored flag", () => {
    vi.stubEnv("LANTERN_TERMINAL_DISABLED", "false");

    expect(toLanternOptions(undefined, { terminalDisabled: true }).terminalDisabled).toBe(true);
  });

  it("still resolves a stored hostname through the loopback rules", () => {
    expect(toLanternOptions(undefined, { hostname: "localhost" }).hostname).toBe("127.0.0.1");
  });

  /**
   * `export LANTERN_HOSTNAME=` is how a shell profile clears a variable, not
   * how it answers a question — treating it as answered would make the stored
   * tier unreachable for anyone whose dotfiles do that.
   */
  it("treats an exported-but-empty variable as unset", () => {
    vi.stubEnv("LANTERN_HOSTNAME", "");
    vi.stubEnv("LANTERN_CLAUDE_DIR", "");
    vi.stubEnv("PORT", "");

    const options = toLanternOptions(undefined, {
      hostname: "0.0.0.0",
      claudeDir: "/from/file",
      port: 3400,
    });

    expect(options.hostname).toBe("0.0.0.0");
    expect(options.claudeDir).toBe("/from/file");
    expect(options.port).toBe(3400);
  });

  /** The stored selection lives in sources.json, which this tier must not shadow. */
  it("leaves sources alone", () => {
    expect(toLanternOptions(undefined, { port: 3400 }).sources).toBeUndefined();
  });

  /**
   * A command that listens on nothing has no port to give, and `??` would take an
   * empty string as the answer — `Number.parseInt("")` is `NaN`, which then wins
   * over the stored port and the default alike.
   */
  it("ignores a flag that was not typed", () => {
    const options = toLanternOptions({ claudeDir: "/from/flag" }, { port: 3400 });

    expect(options.port).toBe(3400);
    expect(options.claudeDir).toBe("/from/flag");
  });
});

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

  /**
   * The regression this exists for: a service that resolves a path while it is
   * being built — the source roots, the cache file — sees the options as they
   * were at construction. `Live` has only the environment then, so a CLI
   * command that provides `Live` and loads the flags afterwards reads the
   * wrong directory however early it calls `loadCliOptions`.
   */
  it.live("has the options before anything else is constructed", () =>
    Effect.gen(function* () {
      const optionsService = yield* LanternOptionsService;

      expect(yield* optionsService.getOption("claudeDir")).toBe("/fixtures/claude-home");
      expect(yield* optionsService.getOption("port")).toBe(4100);
    }).pipe(
      Effect.provide(
        LanternOptionsService.withOptions({
          port: "4100",
          hostname: "127.0.0.1",
          claudeDir: "/fixtures/claude-home",
        }),
      ),
    ),
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

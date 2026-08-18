import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, expect, test } from "vitest";
import { testPlatformLayer } from "../../../../testing/layers/testPlatformLayer.ts";
import type { EnvSchema } from "../../platform/schema.ts";
import { BillingModeService } from "./BillingModeService.ts";

/**
 * The pure decision is covered by detectBillingMode.test.ts. What is exercised
 * here is everything around it - a file that is absent, unreadable or not JSON
 * at all - because that is where a wrong answer would come from in practice,
 * and because a machine with no credentials file must say so rather than guess.
 *
 * Real files in a temp directory rather than a mocked FileSystem: the point is
 * that the paths and the parsing hold up against a disk.
 */
let claudeDir: string;

beforeEach(() => {
  claudeDir = mkdtempSync(join(tmpdir(), "lantern-billing-"));
});

afterEach(() => {
  rmSync(claudeDir, { recursive: true, force: true });
});

const write = (fileName: string, contents: string) =>
  writeFileSync(join(claudeDir, fileName), contents);

const detect = (env?: Partial<EnvSchema>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* BillingModeService;
      return yield* service.detect;
    }).pipe(
      Effect.provide(
        BillingModeService.Live.pipe(
          Layer.provide(
            testPlatformLayer({
              claudeCodePaths: { globalClaudeDirectoryPath: claudeDir },
              ...(env === undefined ? {} : { env }),
            }),
          ),
        ),
      ),
      Effect.provide(NodeFileSystem.layer),
    ),
  );

test("reads the plan out of a stored subscription login", async () => {
  write(
    ".credentials.json",
    JSON.stringify({
      claudeAiOauth: {
        accessToken: "must-not-escape",
        refreshToken: "must-not-escape-either",
        subscriptionType: "max",
      },
    }),
  );

  const detection = await detect();

  expect(detection.mode).toBe("subscription");
  expect(detection.subscriptionType).toBe("max");
});

test("carries no part of the credentials file beyond the plan name", async () => {
  write(
    ".credentials.json",
    JSON.stringify({
      claudeAiOauth: {
        accessToken: "sk-ant-oat-secret",
        refreshToken: "sk-ant-ort-secret",
        subscriptionType: "pro",
      },
    }),
  );

  const detection = await detect();

  expect(JSON.stringify(detection)).not.toContain("secret");
  expect(Object.keys(detection).toSorted()).toStrictEqual(["mode", "reason", "subscriptionType"]);
});

test("says it cannot tell when there is no credentials file", async () => {
  const detection = await detect();

  expect(detection.mode).toBe("unknown");
  expect(detection.reason).toBe("no-signal");
});

test("survives a credentials file that is not JSON", async () => {
  write(".credentials.json", "{ this is not json");

  const detection = await detect();

  expect(detection.mode).toBe("unknown");
});

test("survives an empty credentials file", async () => {
  write(".credentials.json", "");

  const detection = await detect();

  expect(detection.mode).toBe("unknown");
});

test("treats credentials with no oauth section as no signal", async () => {
  write(".credentials.json", JSON.stringify({ mcpOAuth: {} }));

  const detection = await detect();

  expect(detection.mode).toBe("unknown");
});

test("finds an api key helper in the local settings file too", async () => {
  write(".credentials.json", JSON.stringify({ claudeAiOauth: { subscriptionType: "max" } }));
  write("settings.local.json", JSON.stringify({ apiKeyHelper: "/usr/local/bin/get-key" }));

  const detection = await detect();

  expect(detection.mode).toBe("api");
  expect(detection.reason).toBe("api-key-helper");
});

test("an empty api key helper is not a helper", async () => {
  write(".credentials.json", JSON.stringify({ claudeAiOauth: { subscriptionType: "max" } }));
  write("settings.json", JSON.stringify({ apiKeyHelper: "" }));

  const detection = await detect();

  expect(detection.mode).toBe("subscription");
});

test("a key in the environment outranks the stored login", async () => {
  write(".credentials.json", JSON.stringify({ claudeAiOauth: { subscriptionType: "max" } }));

  const detection = await detect({ ANTHROPIC_API_KEY: "sk-ant-example" });

  expect(detection.mode).toBe("api");
  expect(detection.reason).toBe("api-key-env");
});

test("routing through Bedrock is metered despite the stored login", async () => {
  write(".credentials.json", JSON.stringify({ claudeAiOauth: { subscriptionType: "max" } }));

  const detection = await detect({ CLAUDE_CODE_USE_BEDROCK: "1" });

  expect(detection.mode).toBe("api");
  expect(detection.reason).toBe("cloud-provider-env");
});

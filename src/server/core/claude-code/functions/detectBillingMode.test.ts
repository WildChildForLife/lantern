import { expect, test } from "vitest";
import { type BillingSignals, detectBillingMode } from "./detectBillingMode.ts";

const noSignals: BillingSignals = {
  apiKeyEnv: undefined,
  authTokenEnv: undefined,
  cloudProviderEnv: undefined,
  hasApiKeyHelper: false,
  subscriptionType: null,
};

test("a stored subscription login means a flat-rate plan", () => {
  const detection = detectBillingMode({ ...noSignals, subscriptionType: "max" });

  expect(detection.mode).toBe("subscription");
  expect(detection.subscriptionType).toBe("max");
  expect(detection.reason).toBe("oauth-credentials");
});

test("an API key in the environment outranks a login left on disk", () => {
  const detection = detectBillingMode({
    ...noSignals,
    apiKeyEnv: "sk-ant-example",
    subscriptionType: "max",
  });

  expect(detection.mode).toBe("api");
  expect(detection.subscriptionType).toBeNull();
  expect(detection.reason).toBe("api-key-env");
});

test("an auth token and a key helper each mean metered billing too", () => {
  expect(
    detectBillingMode({ ...noSignals, authTokenEnv: "token", subscriptionType: "pro" }).mode,
  ).toBe("api");
  expect(
    detectBillingMode({ ...noSignals, hasApiKeyHelper: true, subscriptionType: "pro" }).mode,
  ).toBe("api");
});

test("an empty environment variable is not a credential", () => {
  const detection = detectBillingMode({
    ...noSignals,
    apiKeyEnv: "   ",
    subscriptionType: "max",
  });

  expect(detection.mode).toBe("subscription");
});

test("routing through a cloud provider is metered, whatever login is on disk", () => {
  const detection = detectBillingMode({
    ...noSignals,
    cloudProviderEnv: "1",
    subscriptionType: "max",
  });

  expect(detection.mode).toBe("api");
  expect(detection.reason).toBe("cloud-provider-env");
});

test("saying nothing beats guessing when the machine gave no signal", () => {
  const detection = detectBillingMode(noSignals);

  expect(detection.mode).toBe("unknown");
  expect(detection.reason).toBe("no-signal");
});

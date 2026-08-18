/**
 * How the Claude Code on this machine is paid for.
 *
 * `subscription` is a flat-rate plan, where a per-token dollar figure is not
 * what anyone was charged. `api` is metered, where it is. `unknown` means the
 * machine did not say, and nothing should be claimed either way.
 */
export type BillingMode = "subscription" | "api" | "unknown";

export type BillingDetection = {
  readonly mode: BillingMode;
  /** The plan name as Claude Code records it - `max`, `pro`, ... */
  readonly subscriptionType: string | null;
  /**
   * Which signal decided it. Diagnostic only - nothing branches on this, but a
   * wrong answer is otherwise very hard to explain from the outside.
   */
  readonly reason:
    | "api-key-env"
    | "auth-token-env"
    | "cloud-provider-env"
    | "api-key-helper"
    | "oauth-credentials"
    | "no-signal";
};

export type BillingSignals = {
  /** `ANTHROPIC_API_KEY`, if the server can see it. */
  readonly apiKeyEnv: string | undefined;
  readonly authTokenEnv: string | undefined;
  /**
   * `CLAUDE_CODE_USE_BEDROCK` / `CLAUDE_CODE_USE_VERTEX`. Both route inference
   * through a cloud account, which is metered even though neither sets an
   * Anthropic key - without this a stale login on disk reads as a subscription.
   */
  readonly cloudProviderEnv: string | undefined;
  /**
   * Whether any settings file in scope defines `apiKeyHelper`. Claude Code
   * merges global, local and project settings, so one is not enough to look at.
   */
  readonly hasApiKeyHelper: boolean;
  /** `claudeAiOauth.subscriptionType` from the credentials file. */
  readonly subscriptionType: string | null;
};

const isSet = (value: string | undefined): boolean => value !== undefined && value.trim() !== "";

/**
 * Reads the machine's own answer, in the order Claude Code itself resolves
 * credentials: an explicit key or token in the environment wins, then a helper
 * that produces one, and only then the stored login.
 *
 * A subscription login can sit on disk on a machine that bills to an API key -
 * signing in once leaves the credentials there for good - so the presence of
 * OAuth credentials is the weakest signal of the four, never the first.
 */
export const detectBillingMode = (signals: BillingSignals): BillingDetection => {
  if (isSet(signals.apiKeyEnv)) {
    return { mode: "api", subscriptionType: null, reason: "api-key-env" };
  }

  if (isSet(signals.authTokenEnv)) {
    return { mode: "api", subscriptionType: null, reason: "auth-token-env" };
  }

  if (isSet(signals.cloudProviderEnv)) {
    return { mode: "api", subscriptionType: null, reason: "cloud-provider-env" };
  }

  if (signals.hasApiKeyHelper) {
    return { mode: "api", subscriptionType: null, reason: "api-key-helper" };
  }

  if (signals.subscriptionType !== null && signals.subscriptionType.trim() !== "") {
    return {
      mode: "subscription",
      subscriptionType: signals.subscriptionType,
      reason: "oauth-credentials",
    };
  }

  return { mode: "unknown", subscriptionType: null, reason: "no-signal" };
};

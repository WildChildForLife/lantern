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
  /** Why it came out this way, so the UI can say so rather than assert. */
  readonly reason:
    | "api-key-env"
    | "auth-token-env"
    | "api-key-helper"
    | "oauth-credentials"
    | "no-signal";
};

export type BillingSignals = {
  /** `ANTHROPIC_API_KEY`, if the server can see it. */
  readonly apiKeyEnv: string | undefined;
  readonly authTokenEnv: string | undefined;
  /** Whether settings.json defines `apiKeyHelper`. */
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

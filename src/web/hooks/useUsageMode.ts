import { useQuery } from "@tanstack/react-query";
import { useConfig } from "@/web/app/hooks/useConfig";
import { billingModeQuery } from "@/web/lib/api/queries";

export type UsageMode = "subscription" | "api";

/** The CLI usage mode describes. For any other, the question has no answer. */
const CLAUDE_CODE = "claude-code";

export type ResolvedUsageMode = {
  /** What to act on. Null while unknown - claim nothing rather than guess. */
  readonly mode: UsageMode | null;
  /** What the machine said, regardless of any stored answer. */
  readonly detected: UsageMode | null;
  /** The plan name Claude Code recorded, when it is a subscription. */
  readonly subscriptionType: string | null;
  /**
   * Whether detection has finished. Distinguishes "could not tell" from "has
   * not looked yet" - without it, everything downstream reads an in-flight
   * query as a definitive no, and flickers or prompts on every cold load.
   */
  readonly isSettled: boolean;
};

/**
 * How the Claude Code behind this Lantern is paid for.
 *
 * Answered by the machine where it can be - a stored subscription login, or a
 * key in the environment - so nobody is asked a question their own setup
 * already answers. An explicit `subscription` or `api` still wins, because
 * detection reads one machine and someone may know better; `auto` defers to
 * detection on purpose.
 */
export const useUsageMode = (): ResolvedUsageMode => {
  const { config, isConfigLoaded } = useConfig();
  const { data, isSuccess, isError } = useQuery(billingModeQuery);

  const billing = data?.billing;
  const detected: UsageMode | null =
    billing?.mode === "subscription" || billing?.mode === "api" ? billing.mode : null;

  const stored = config?.usageMode;
  const override = stored === "subscription" || stored === "api" ? stored : null;

  // Usage mode is a Claude Code concept. Answering it for a session recorded by
  // another CLI would put a claim about the wrong vendor's billing on screen.
  const appliesHere = config?.primarySource === undefined || config.primarySource === CLAUDE_CODE;

  return {
    mode: appliesHere ? (override ?? detected) : null,
    detected,
    subscriptionType: billing?.subscriptionType ?? null,
    // An error settles it too: the answer is "could not tell", not "not yet".
    isSettled: isConfigLoaded && (isSuccess || isError),
  };
};

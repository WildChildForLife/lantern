import { useQuery } from "@tanstack/react-query";
import { useConfig } from "@/web/app/hooks/useConfig";
import { billingModeQuery } from "@/web/lib/api/queries";

export type UsageMode = "subscription" | "api";

export type ResolvedUsageMode = {
  /** What to act on. Null while unknown - claim nothing rather than guess. */
  readonly mode: UsageMode | null;
  /** What the machine said, regardless of any override. */
  readonly detected: UsageMode | null;
  /** The plan name Claude Code recorded, when it is a subscription. */
  readonly subscriptionType: string | null;
  /** True when the stored setting disagrees with what was detected. */
  readonly isOverridden: boolean;
};

/**
 * How the Claude Code behind this Lantern is paid for.
 *
 * Answered by the machine where it can be - a stored subscription login, or a
 * key in the environment - so nobody is asked a question their own setup
 * already answers. The saved setting stays authoritative when present, because
 * detection reads one machine and someone may know better.
 */
export const useUsageMode = (): ResolvedUsageMode => {
  const { config } = useConfig();
  const { data } = useQuery(billingModeQuery);

  const billing = data?.billing;
  const detected: UsageMode | null =
    billing?.mode === "subscription" || billing?.mode === "api" ? billing.mode : null;

  const override = config?.usageMode ?? null;

  return {
    mode: override ?? detected,
    detected,
    subscriptionType: billing?.subscriptionType ?? null,
    isOverridden: override !== null && detected !== null && override !== detected,
  };
};

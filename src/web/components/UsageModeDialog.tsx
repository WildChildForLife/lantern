import { Trans, useLingui } from "@lingui/react";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, CreditCardIcon, KeyIcon, TerminalIcon } from "lucide-react";
import { type FC, useState } from "react";
import { useConfig } from "@/web/app/hooks/useConfig";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { sourcesQuery } from "@/web/lib/api/queries";

/** The CLI Lantern drives interactively, and the only one usage mode applies to. */
const CLAUDE_CODE = "claude-code";

/**
 * First-run setup.
 *
 * Two questions, and the second only sometimes. Which agent CLI Lantern works
 * with is asked of everyone; how that CLI is paid for is a Claude Code question
 * and is skipped for anything else, where it means nothing.
 *
 * Sources are offered as the server detected them. A CLI that is installed and
 * has sessions is marked as found; one that is not is shown anyway, disabled
 * and with the reason, because a missing CLI is more usefully explained than
 * hidden.
 */
export const UsageModeDialog: FC = () => {
  const { i18n } = useLingui();
  const { config, updateConfig, isConfigLoaded } = useConfig();
  const { data, isPending } = useQuery(sourcesQuery);

  const [picked, setPicked] = useState<string | null>(null);

  const needsSource = isConfigLoaded && config.primarySource === undefined;
  // Only asked once a CLI is chosen, and only for the one it applies to.
  const chosen = picked ?? config.primarySource;
  const needsUsageMode =
    isConfigLoaded && !needsSource && chosen === CLAUDE_CODE && config.usageMode === undefined;

  const isOpen = needsSource || needsUsageMode;

  const selectSource = (sourceId: string) => {
    setPicked(sourceId);
    // Usage mode is a Claude Code concept. Choosing anything else answers it by
    // making it irrelevant, rather than leaving a dialog the user cannot clear.
    updateConfig({
      ...config,
      primarySource: sourceId,
      ...(sourceId === CLAUDE_CODE ? {} : { usageMode: "api" as const }),
    });
  };

  const selectUsageMode = (mode: "subscription" | "api") => {
    updateConfig({ ...config, usageMode: mode });
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="max-w-md sm:max-w-lg"
      >
        {needsSource ? (
          <>
            <DialogHeader>
              <DialogTitle>
                <Trans id="setup.source.title" message="Which agent CLI should Lantern use?" />
              </DialogTitle>
              <DialogDescription>
                <Trans
                  id="setup.source.description"
                  message="Lantern reads this CLI's conversations and asks it to name topics. You can change this later in settings."
                />
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 pt-2">
              {isPending ? (
                <p className="text-muted-foreground text-sm">
                  <Trans id="setup.source.detecting" message="Looking for installed CLIs…" />
                </p>
              ) : (
                (data?.sources ?? []).map((source) => (
                  <Button
                    key={source.id}
                    variant="outline"
                    disabled={!source.supported}
                    className="flex h-auto flex-col items-start gap-2 p-4 text-left whitespace-normal"
                    onClick={() => selectSource(source.id)}
                  >
                    <div className="flex w-full items-center gap-2 font-semibold">
                      <TerminalIcon className="size-5 shrink-0" />
                      <span>{source.displayName}</span>
                      {source.supported ? (
                        <span className="ml-auto flex items-center gap-1 text-xs font-normal text-muted-foreground">
                          <CheckIcon className="size-3.5" />
                          <Trans id="setup.source.detected" message="Detected" />
                        </span>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground text-xs font-normal leading-relaxed">
                      {source.supported ? (
                        <Trans
                          id="setup.source.session_count"
                          message="{count} conversations found"
                          values={{ count: source.stats.sessions }}
                        />
                      ) : (
                        i18n._({
                          id: "setup.source.unavailable",
                          message: "Not available on this machine",
                        })
                      )}
                    </p>
                  </Button>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                <Trans id="usage_mode.dialog.title" message="How do you use Claude Code?" />
              </DialogTitle>
              <DialogDescription>
                <Trans
                  id="usage_mode.dialog.description"
                  message="Please select your usage mode. You can change this later in settings."
                />
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 pt-2">
              <Button
                variant="outline"
                className="flex h-auto flex-col items-start gap-2 p-4 text-left whitespace-normal"
                onClick={() => selectUsageMode("subscription")}
              >
                <div className="flex items-center gap-2 font-semibold">
                  <CreditCardIcon className="size-5 shrink-0" />
                  <span>
                    <Trans id="usage_mode.subscription.label" message="Subscription" />
                  </span>
                </div>
                <p className="text-muted-foreground text-xs font-normal leading-relaxed">
                  <Trans
                    id="usage_mode.subscription.description"
                    message="You use Claude Code with a subscription plan (Max, Pro, etc.). Some features that require the Agent SDK will be restricted."
                  />
                </p>
              </Button>

              <Button
                variant="outline"
                className="flex h-auto flex-col items-start gap-2 p-4 text-left whitespace-normal"
                onClick={() => selectUsageMode("api")}
              >
                <div className="flex items-center gap-2 font-semibold">
                  <KeyIcon className="size-5 shrink-0" />
                  <span>
                    <Trans id="usage_mode.api.label" message="API" />
                  </span>
                </div>
                <p className="text-muted-foreground text-xs font-normal leading-relaxed">
                  <Trans
                    id="usage_mode.api.description"
                    message="You use Claude Code with API keys. All features are available."
                  />
                </p>
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

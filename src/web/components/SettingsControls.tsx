import { Trans } from "@lingui/react";
import { useQueryClient } from "@tanstack/react-query";
import { type FC, useId } from "react";
import { useConfig } from "@/web/app/hooks/useConfig";
import { PrimarySourceSelect } from "@/web/components/PrimarySourceSelect";
import { AppearanceSettings } from "@/web/components/settings/AppearanceSettings";
import { InputSettings } from "@/web/components/settings/InputSettings";
import { SettingsSection } from "@/web/components/settings/SettingsSection";
import { Checkbox } from "@/web/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { projectDetailQuery, projectListQuery } from "@/web/lib/api/queries";

type SettingsControlsProps = {
  openingProjectId: string;
  showLabels?: boolean;
  showDescriptions?: boolean;
  className?: string;
};

/**
 * Every setting, grouped.
 *
 * It used to be one unbroken column of a dozen unrelated controls — which CLI
 * to use sat directly above which key sends a message — so finding one meant
 * reading all of them. The groups below are the questions a person actually
 * arrives with.
 *
 * The keyboard and appearance groups live in their own files: this one is
 * against a 500-line cap, and splitting on a section boundary keeps each piece
 * about one thing.
 */
export const SettingsControls: FC<SettingsControlsProps> = ({
  openingProjectId,
  showLabels = true,
  showDescriptions = true,
  className = "",
}: SettingsControlsProps) => {
  const usageModeId = useId();
  const primarySourceId = useId();
  const hideNoUserMessageId = useId();
  const unifySameTitleId = useId();
  const autoScheduleId = useId();

  const { config, updateConfig } = useConfig();
  const queryClient = useQueryClient();

  const isUsageMode = (value: string): value is "subscription" | "api" =>
    value === "subscription" || value === "api";

  const changeUsageMode = (value: string) => {
    if (!isUsageMode(value)) return;
    updateConfig({ ...config, usageMode: value });
  };

  const toggleHideNoUserMessage = () => {
    updateConfig(
      { ...config, hideNoUserMessageSession: !config?.hideNoUserMessageSession },
      {
        onSuccess: async () => {
          await queryClient.refetchQueries({ queryKey: projectListQuery.queryKey });
        },
      },
    );
  };

  const toggleUnifySameTitle = () => {
    updateConfig(
      { ...config, unifySameTitleSession: !config?.unifySameTitleSession },
      {
        onSuccess: async () => {
          await queryClient.refetchQueries({
            queryKey: projectDetailQuery(openingProjectId).queryKey,
          });
        },
      },
    );
  };

  const toggleAutoSchedule = () => {
    updateConfig({
      ...config,
      autoScheduleContinueOnRateLimit: !config?.autoScheduleContinueOnRateLimit,
    });
  };

  // Usage mode is a Claude Code concept; for any other CLI it has no answer
  // worth storing, so the question is not asked.
  const showUsageMode =
    config?.primarySource === "claude-code" || config?.primarySource === undefined;

  return (
    <div className={`space-y-8 ${className}`}>
      <SettingsSection
        title={<Trans id="settings.section.agent_cli" message="Agent CLI" />}
        description={
          <Trans
            id="settings.section.agent_cli.description"
            message="Which CLI Lantern works with, and how it is paid for."
          />
        }
      >
        <div className="space-y-2">
          {showLabels && (
            <label htmlFor={primarySourceId} className="text-sm font-medium leading-none">
              <Trans id="settings.primary_source" message="Agent CLI" />
            </label>
          )}
          <PrimarySourceSelect id={primarySourceId} />
        </div>

        {showUsageMode ? (
          <div className="space-y-2">
            {showLabels && (
              <label htmlFor={usageModeId} className="text-sm font-medium leading-none">
                <Trans id="settings.usage_mode" message="Usage Mode" />
              </label>
            )}
            <Select value={config?.usageMode ?? ""} onValueChange={changeUsageMode}>
              <SelectTrigger id={usageModeId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="subscription">
                  <Trans
                    id="settings.usage_mode.subscription"
                    message="Subscription (Max, Pro, etc.)"
                  />
                </SelectItem>
                <SelectItem value="api">
                  <Trans id="settings.usage_mode.api" message="API" />
                </SelectItem>
              </SelectContent>
            </Select>
            {showDescriptions && (
              <p className="text-xs text-muted-foreground mt-1">
                <Trans
                  id="settings.usage_mode.description"
                  message="Select how you use Claude Code. This only affects how session costs are reported; every feature works either way."
                />
              </p>
            )}
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title={<Trans id="settings.section.conversations" message="Conversations" />}
        description={
          <Trans
            id="settings.section.conversations.description"
            message="What appears in the lists."
          />
        }
      >
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <Checkbox
              id={hideNoUserMessageId}
              checked={config?.hideNoUserMessageSession}
              onCheckedChange={toggleHideNoUserMessage}
            />
            {showLabels && (
              <label htmlFor={hideNoUserMessageId} className="text-sm font-medium leading-none">
                <Trans id="settings.session.hide_no_user_message" />
              </label>
            )}
          </div>
          {showDescriptions && (
            <p className="text-xs text-muted-foreground ml-6">
              <Trans id="settings.session.hide_no_user_message.description" />
            </p>
          )}
        </div>

        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <Checkbox
              id={unifySameTitleId}
              checked={config?.unifySameTitleSession}
              onCheckedChange={toggleUnifySameTitle}
            />
            {showLabels && (
              <label htmlFor={unifySameTitleId} className="text-sm font-medium leading-none">
                <Trans id="settings.session.unify_same_title" />
              </label>
            )}
          </div>
          {showDescriptions && (
            <p className="text-xs text-muted-foreground ml-6">
              <Trans id="settings.session.unify_same_title.description" />
            </p>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title={<Trans id="settings.section.automation" message="Automation" />}
        description={
          <Trans
            id="settings.section.automation.description"
            message="What Lantern does on its own."
          />
        }
      >
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <Checkbox
              id={autoScheduleId}
              checked={config?.autoScheduleContinueOnRateLimit}
              onCheckedChange={toggleAutoSchedule}
            />
            {showLabels && (
              <label htmlFor={autoScheduleId} className="text-sm font-medium leading-none">
                <Trans id="settings.session.auto_schedule_continue_on_rate_limit" />
              </label>
            )}
          </div>
          {showDescriptions && (
            <p className="text-xs text-muted-foreground ml-6">
              <Trans id="settings.session.auto_schedule_continue_on_rate_limit.description" />
            </p>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title={<Trans id="settings.section.input" message="Keyboard & models" />}
        description={
          <Trans
            id="settings.section.input.description"
            message="Shortcuts, and the models offered in the session toolbar."
          />
        }
      >
        <InputSettings showLabels={showLabels} showDescriptions={showDescriptions} />
      </SettingsSection>

      <SettingsSection title={<Trans id="settings.section.appearance" message="Appearance" />}>
        <AppearanceSettings showLabels={showLabels} showDescriptions={showDescriptions} />
      </SettingsSection>
    </div>
  );
};

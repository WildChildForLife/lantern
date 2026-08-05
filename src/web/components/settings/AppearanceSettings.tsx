import { Trans, useLingui } from "@lingui/react";
import { type FC, useId, useMemo } from "react";
import { DEFAULT_LOCALE, detectLocaleFromNavigator } from "@/lib/i18n/localeDetection";
import type { SupportedLocale } from "@/lib/i18n/schema";
import { useConfig } from "@/web/app/hooks/useConfig";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { useTheme } from "@/web/hooks/useTheme";

/** Language and theme, split out of `SettingsControls` to keep it under its cap. */
export const AppearanceSettings: FC<{ showLabels?: boolean; showDescriptions?: boolean }> = ({
  showLabels = true,
  showDescriptions = true,
}) => {
  const { i18n } = useLingui();
  const { config, updateConfig } = useConfig();
  const { theme } = useTheme();

  const localeId = useId();
  const themeId = useId();

  const inferredLocale = useMemo(() => detectLocaleFromNavigator() ?? DEFAULT_LOCALE, []);

  const changeLocale = (value: SupportedLocale) => {
    updateConfig({ ...config, locale: value });
  };

  const changeTheme = (value: "light" | "dark" | "system") => {
    updateConfig({ ...config, theme: value });
  };

  return (
    <>
      <div className="space-y-2">
        {showLabels && (
          <label htmlFor={localeId} className="text-sm font-medium leading-none">
            <Trans id="settings.locale" />
          </label>
        )}
        <Select value={config?.locale || inferredLocale} onValueChange={changeLocale}>
          <SelectTrigger id={localeId} className="w-full">
            <SelectValue placeholder={i18n._("Select language")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ja">
              <Trans id="settings.locale.ja" />
            </SelectItem>
            <SelectItem value="en">
              <Trans id="settings.locale.en" />
            </SelectItem>
            <SelectItem value="zh_CN">
              <Trans id="settings.locale.zh_CN" />
            </SelectItem>
            <SelectItem value="es">
              <Trans id="settings.locale.es" message="Spanish" />
            </SelectItem>
            <SelectItem value="fr">
              <Trans id="settings.locale.fr" message="French" />
            </SelectItem>
            <SelectItem value="pt">
              <Trans id="settings.locale.pt" message="Portuguese" />
            </SelectItem>
          </SelectContent>
        </Select>
        {showDescriptions && (
          <p className="text-xs text-muted-foreground mt-1">
            <Trans id="settings.locale.description" />
          </p>
        )}
      </div>

      <div className="space-y-2">
        {showLabels && (
          <label htmlFor={themeId} className="text-sm font-medium leading-none">
            <Trans id="settings.theme" />
          </label>
        )}
        <Select value={theme ?? "system"} onValueChange={changeTheme}>
          <SelectTrigger id={themeId} className="w-full">
            <SelectValue placeholder={i18n._("Select theme")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="light">
              <Trans id="settings.theme.light" />
            </SelectItem>
            <SelectItem value="dark">
              <Trans id="settings.theme.dark" />
            </SelectItem>
            <SelectItem value="system">
              <Trans id="settings.theme.system" />
            </SelectItem>
          </SelectContent>
        </Select>
        {showDescriptions && (
          <p className="text-xs text-muted-foreground mt-1">
            <Trans id="settings.theme.description" />
          </p>
        )}
      </div>
    </>
  );
};

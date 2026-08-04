import { Trans, useLingui } from "@lingui/react";
import { useQuery } from "@tanstack/react-query";
import type { FC } from "react";
import { useConfig } from "@/web/app/hooks/useConfig";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { sourcesQuery } from "@/web/lib/api/queries";

/**
 * Which agent CLI Lantern works with.
 *
 * One at a time, unlike the read-toggles above it: this is the CLI whose login
 * gets used to name topics, and running two would bill two accounts for the
 * same answer.
 *
 * Its own file because `SettingsControls` sits against the 500-line cap.
 */
export const PrimarySourceSelect: FC<{ id?: string }> = ({ id }) => {
  const { i18n } = useLingui();
  const { config, updateConfig } = useConfig();
  const { data, isPending } = useQuery(sourcesQuery);

  const change = (sourceId: string) => {
    updateConfig({ ...config, primarySource: sourceId });
  };

  return (
    <>
      <Select value={config?.primarySource ?? ""} onValueChange={change} disabled={isPending}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue
            placeholder={i18n._({
              id: "settings.primary_source.select",
              message: "Select an agent CLI",
            })}
          />
        </SelectTrigger>
        <SelectContent>
          {(data?.sources ?? []).map((source) => (
            // Undetected CLIs stay listed but unselectable: a name that is
            // simply absent reads as one Lantern has never heard of.
            <SelectItem key={source.id} value={source.id} disabled={!source.supported}>
              {source.displayName}
              {source.supported
                ? ""
                : ` — ${i18n._({ id: "settings.primary_source.unavailable", message: "not available" })}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground mt-1">
        <Trans
          id="settings.primary_source.description"
          message="The CLI Lantern centres on, and the one asked to name topics. Other enabled CLIs stay readable."
        />
      </p>
    </>
  );
};

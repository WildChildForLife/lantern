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
 * One at a time, unlike the tiles above it: those say which histories to show,
 * this says whose login gets used when a CLI is asked something, and running
 * two would bill two accounts for the same answer.
 *
 * Offers only the CLIs that are switched on above. Choosing a CLI Lantern has
 * been told not to read would be a setting that contradicts the one next to it.
 */
export const PrimarySourceSelect: FC<{ id?: string }> = ({ id }) => {
  const { i18n } = useLingui();
  const { config, updateConfig } = useConfig();
  const { data, isPending } = useQuery(sourcesQuery);

  const selectable = (data?.sources ?? []).filter((source) => source.enabled && source.supported);

  const current = config?.primarySource;
  const isCurrentSelectable = selectable.some((source) => source.id === current);

  // Deliberately no effect that corrects the stored value here. Writing config
  // from a render that also reads it loops: the write invalidates the query,
  // the refetch makes a new object, and the effect fires again. Both directions
  // are handled where the change actually happens — the tiles above.

  const change = (sourceId: string) => {
    updateConfig({ ...config, primarySource: sourceId });
  };

  if (!isPending && selectable.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        <Trans
          id="settings.primary_source.none"
          message="No agent CLI is switched on above, so there is nothing to work with."
        />
      </p>
    );
  }

  return (
    <>
      <Select
        value={isCurrentSelectable ? current : ""}
        onValueChange={change}
        disabled={isPending}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue
            placeholder={i18n._({
              id: "settings.primary_source.select",
              message: "Select an agent CLI",
            })}
          />
        </SelectTrigger>
        <SelectContent>
          {selectable.map((source) => (
            <SelectItem key={source.id} value={source.id}>
              {source.displayName}
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

import { Trans, useLingui } from "@lingui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FC, useState } from "react";
import { useConfig } from "@/web/app/hooks/useConfig";
import { honoClient } from "@/web/lib/api/client";
import { sourcesQuery } from "@/web/lib/api/queries";
import { SourceTile } from "./settings/SourceTile";

/** The ids the API accepts, taken from the request type so they cannot drift. */
type SourceId = Parameters<typeof honoClient.api.sources.$put>[0]["json"]["enabled"][number];

type UnsupportedReason =
  | "not-installed"
  | "no-data"
  | "sqlite-storage"
  | "unknown-shape"
  | "schema-changed";

/**
 * Why a detected source cannot be read. Shown instead of silently leaving it
 * out of the list, which reads as "Lantern does not know about this CLI".
 */
const useUnsupportedLabel = () => {
  const { i18n } = useLingui();

  return (reason: UnsupportedReason | null): string => {
    const labels: Record<UnsupportedReason, string> = {
      "not-installed": i18n._({
        id: "sources.reason.not_installed",
        message: "not found on this machine",
      }),
      "no-data": i18n._({ id: "sources.reason.no_data", message: "no sessions recorded yet" }),
      "sqlite-storage": i18n._({
        id: "sources.reason.sqlite_storage",
        message: "stores sessions in a database Lantern cannot read yet",
      }),
      "schema-changed": i18n._({
        id: "sources.reason.schema_changed",
        message: "storage format changed in a newer release",
      }),
      "unknown-shape": i18n._({
        id: "sources.reason.unknown_shape",
        message: "sessions are in a format Lantern does not recognise",
      }),
    };

    return reason === null ? labels["unknown-shape"] : labels[reason];
  };
};

export const SourcesSettings: FC<{ showDescriptions?: boolean }> = ({
  showDescriptions = true,
}) => {
  const queryClient = useQueryClient();
  const { config, updateConfig } = useConfig();
  const unsupportedLabel = useUnsupportedLabel();
  const { data, isPending, isError, isFetching } = useQuery(sourcesQuery);
  // The response to a change is computed before the purge and re-read finish,
  // so the server's answer is briefly out of date. Until the refetch lands,
  // the checkboxes follow what was submitted.
  const [submitted, setSubmitted] = useState<readonly string[] | null>(null);

  const { mutate: setEnabled, isPending: isMutating } = useMutation({
    mutationFn: async (enabled: SourceId[]) => {
      const response = await honoClient.api.sources.$put({ json: { enabled } });

      if (!response.ok) {
        throw new Error(`Failed to update sources: ${response.statusText}`);
      }

      return await response.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sourcesQuery.queryKey });
    },
    onSettled: () => {
      setSubmitted(null);
    },
  });

  const sources = data?.sources ?? [];
  const isEnabled = (sourceId: string, serverValue: boolean) =>
    submitted === null ? serverValue : submitted.includes(sourceId);

  if (isPending) {
    return (
      <p className="text-xs text-muted-foreground">
        <Trans id="sources.loading" message="Looking for agent CLIs…" />
      </p>
    );
  }

  if (isError) {
    return (
      <p className="text-xs text-destructive">
        <Trans id="sources.error" message="Could not read the list of agent CLIs." />
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {showDescriptions && (
        <p className="text-xs text-muted-foreground">
          <Trans
            id="sources.description"
            message="Which agent CLIs Lantern reads sessions from. Turning one off forgets its conversations; it never touches the files."
          />
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {sources.map((source) => {
          const enabled = isEnabled(source.id, source.enabled);

          return (
            <SourceTile
              key={source.id}
              id={source.id}
              displayName={source.displayName}
              enabled={enabled}
              supported={source.supported}
              interactive={source.capabilities.interactive}
              sessions={source.stats.sessions}
              projects={source.stats.projects}
              unsupportedLabel={unsupportedLabel(source.unsupportedReason)}
              disabled={isFetching || isMutating}
              onToggle={(next: boolean) => {
                const chosen = sources
                  .filter((candidate) =>
                    candidate.id === source.id ? next : isEnabled(candidate.id, candidate.enabled),
                  )
                  .map((candidate) => candidate.id);

                setSubmitted(chosen);
                setEnabled(chosen);

                // The CLI in use has to be one Lantern is reading, so both
                // directions are settled here rather than by an effect that
                // watches config and writes to it — that loops.
                if (next && source.supported) {
                  // Switching one on is as good a statement as picking it.
                  updateConfig({ ...config, primarySource: source.id });
                } else if (!next && config?.primarySource === source.id) {
                  // Switching off the one in use: fall back to whatever is
                  // still on, rather than leaving a name that is no longer read.
                  const replacement = sources.find(
                    (candidate) => candidate.id !== source.id && chosen.includes(candidate.id),
                  );
                  updateConfig({ ...config, primarySource: replacement?.id });
                }
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

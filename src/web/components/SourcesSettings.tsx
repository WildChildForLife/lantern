import { Trans, useLingui } from "@lingui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FC } from "react";
import { honoClient } from "@/web/lib/api/client";
import { sourcesQuery } from "@/web/lib/api/queries";
import { Checkbox } from "./ui/checkbox";

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
  const unsupportedLabel = useUnsupportedLabel();
  const { data } = useQuery(sourcesQuery);

  const { mutate: setEnabled, isPending } = useMutation({
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
  });

  const sources = data?.sources ?? [];

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

      <div className="space-y-2">
        {sources.map((source) => {
          const selectable = source.supported || source.enabled;
          const checkboxId = `source-${source.id}`;

          return (
            <div key={source.id} className="flex items-start gap-2">
              <Checkbox
                id={checkboxId}
                checked={source.enabled}
                disabled={!selectable || isPending}
                onCheckedChange={(checked) => {
                  const enabled = sources
                    .filter((candidate) =>
                      candidate.id === source.id ? checked === true : candidate.enabled,
                    )
                    .map((candidate) => candidate.id);

                  setEnabled(enabled);
                }}
              />
              <div className="min-w-0">
                <label
                  htmlFor={checkboxId}
                  className="text-sm font-medium leading-none cursor-pointer"
                >
                  {source.displayName}
                </label>
                <p className="text-xs text-muted-foreground mt-1">
                  {source.supported ? (
                    <Trans
                      id="sources.stats"
                      message="{sessionCount} conversations across {projectCount} projects"
                      values={{
                        sessionCount: source.stats.sessions,
                        projectCount: source.stats.projects,
                      }}
                    />
                  ) : (
                    unsupportedLabel(source.unsupportedReason)
                  )}
                  {source.capabilities.interactive ? null : (
                    <>
                      {" · "}
                      <Trans id="sources.read_only" message="read-only" />
                    </>
                  )}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

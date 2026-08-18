import { Trans } from "@lingui/react";
import { Link } from "@tanstack/react-router";
import { FolderIcon } from "lucide-react";
import type { FC } from "react";
import { formatLocaleDate } from "@/lib/date/formatLocaleDate";
import { Card, CardContent } from "@/web/components/ui/card";
import { useConfig } from "../../hooks/useConfig";
import { useProjects } from "../hooks/useProjects";

type Props = {
  query?: string;
};

export const ProjectList: FC<Props> = ({ query = "" }) => {
  const {
    data: { projects },
  } = useProjects();
  const { config } = useConfig();

  const normalized = query.trim().toLowerCase();
  const matches = projects.filter((project) => {
    if (normalized === "") {
      return true;
    }

    const name = project.meta.projectName ?? project.claudeProjectPath;

    return (
      name.toLowerCase().includes(normalized) ||
      (project.meta.projectPath ?? "").toLowerCase().includes(normalized)
    );
  });

  if (projects.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <FolderIcon className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">
            <Trans id="project_list.no_projects.title" />
          </h3>
          <p className="text-muted-foreground text-center max-w-md">
            <Trans id="project_list.no_projects.description" />
          </p>
        </CardContent>
      </Card>
    );
  }

  if (matches.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        <Trans
          id="project_list.no_matches"
          message='No projects to show for "{query}".'
          values={{ query }}
        />
      </p>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden">
      {matches.map((project) => (
        <Link
          key={project.id}
          to={"/projects/$projectId/session"}
          params={{ projectId: project.id }}
          className="flex items-center gap-3 px-4 py-3 hover:bg-muted/60 transition-colors"
        >
          <FolderIcon className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">
              {project.meta.projectName ?? project.claudeProjectPath}
            </p>
            {project.meta.projectPath !== undefined && project.meta.projectPath !== "" ? (
              <p className="text-xs text-muted-foreground truncate">{project.meta.projectPath}</p>
            ) : null}
          </div>
          <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
            {project.meta.sessionCount}
          </span>
          <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline tabular-nums">
            {project.lastModifiedAt
              ? formatLocaleDate(project.lastModifiedAt, {
                  locale: config.locale,
                  target: "time",
                })
              : ""}
          </span>
        </Link>
      ))}
    </div>
  );
};

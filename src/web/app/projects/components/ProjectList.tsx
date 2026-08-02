import { Trans } from "@lingui/react";
import { Link } from "@tanstack/react-router";
import { FolderIcon } from "lucide-react";
import type { FC } from "react";
import { useViewMode } from "@/lib/atoms/viewMode";
import { formatLocaleDate } from "@/lib/date/formatLocaleDate";
import { Button } from "@/web/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import { useConfig } from "../../hooks/useConfig";
import { useProjects } from "../hooks/useProjects";

export const ProjectList: FC = () => {
  const {
    data: { projects },
  } = useProjects();
  const { config } = useConfig();
  const { viewMode } = useViewMode();

  if (projects.length === 0) {
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
    </Card>;
  }

  // Anything that is not the grid (including the topics table) falls back to rows.
  if (viewMode !== "grid") {
    return (
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden">
        {projects.map((project) => (
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
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <Card key={project.id} className="hover:shadow-md transition-shadow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 justify-start items-start">
              <FolderIcon className="w-5 h-5 flex-shrink-0" />
              <span className="text-wrap flex-1">
                {project.meta.projectName ?? project.claudeProjectPath}
              </span>
            </CardTitle>
            {project.meta.projectPath !== undefined && project.meta.projectPath !== "" ? (
              <CardDescription>{project.meta.projectPath}</CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              <Trans id="project_list.last_modified" />{" "}
              {project.lastModifiedAt
                ? formatLocaleDate(project.lastModifiedAt, {
                    locale: config.locale,
                    target: "time",
                  })
                : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              <Trans id="project_list.messages" /> {project.meta.sessionCount}
            </p>
          </CardContent>
          <CardContent className="pt-0">
            <Button asChild className="w-full">
              <Link to={"/projects/$projectId/session"} params={{ projectId: project.id }}>
                <Trans id="project_list.view_conversations" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

import { FileSystem, Path } from "@effect/platform";
import { desc, eq } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { DrizzleService } from "../../../lib/db/DrizzleService.ts";
import { projects } from "../../../lib/db/schema.ts";
import type { InferEffect } from "../../../lib/effect/types.ts";
import { ApplicationContext } from "../../platform/services/ApplicationContext.ts";
import { resolveSourceRoots } from "../../source/functions/sourceRoots.ts";
import { CLAUDE_CODE_SOURCE_ID, sourceIdSchema } from "../../source/models/SourceId.ts";
import { SourceRegistry } from "../../source/services/SourceRegistry.ts";
import type { Project } from "../../types.ts";
import { decodeProjectId, validateProjectPath } from "../functions/id.ts";
import { ProjectMetaService } from "../services/ProjectMetaService.ts";

const LayerImpl = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const projectMetaService = yield* ProjectMetaService;
  const context = yield* ApplicationContext;
  const { db } = yield* DrizzleService;
  const registry = yield* SourceRegistry;
  const path = yield* Path.Path;

  const rootsBySource = yield* resolveSourceRoots(registry.all).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(FileSystem.FileSystem, fs),
        Layer.succeed(Path.Path, path),
        Layer.succeed(ApplicationContext, context),
      ),
    ),
  );

  const getProject = (projectId: string) =>
    Effect.gen(function* () {
      const fullPath = decodeProjectId(projectId);

      const row = db
        .select({ source: projects.source, dirMtimeMs: projects.dirMtimeMs })
        .from(projects)
        .where(eq(projects.id, projectId))
        .get();

      // No row means the project has not been synced yet, which for Claude Code
      // is ordinary: a directory exists before Lantern has seen it.
      const parsedSource = sourceIdSchema.safeParse(row?.source);
      const sourceId = parsedSource.success ? parsedSource.data : CLAUDE_CODE_SOURCE_ID;
      const roots = rootsBySource.get(sourceId);

      // Checked against the roots of the source that owns the project rather
      // than the Claude directory, which no other source's project is under.
      if (roots === undefined || !validateProjectPath(fullPath, roots)) {
        return yield* Effect.fail(new Error("Invalid project path: outside allowed directory"));
      }

      // A source that partitions its history by date has no project directory:
      // the id decodes to a path under its root that is never opened, so there
      // is nothing to stat and the cached timestamp is the only one there is.
      if (sourceId !== CLAUDE_CODE_SOURCE_ID) {
        if (row === undefined) {
          return yield* Effect.fail(new Error("Project not found"));
        }

        const meta = yield* projectMetaService.getProjectMeta(projectId);

        return {
          project: {
            id: projectId,
            claudeProjectPath: fullPath,
            lastModifiedAt: new Date(row.dirMtimeMs),
            meta,
          },
        };
      }

      // Check if project directory exists
      const exists = yield* fs.exists(fullPath);
      if (!exists) {
        return yield* Effect.fail(new Error("Project not found"));
      }

      // Get file stats
      const stat = yield* fs.stat(fullPath);

      // Get project metadata
      const meta = yield* projectMetaService.getProjectMeta(projectId);

      return {
        project: {
          id: projectId,
          claudeProjectPath: fullPath,
          lastModifiedAt: Option.getOrElse(stat.mtime, () => new Date()),
          meta,
        },
      };
    });

  const getProjects = () =>
    Effect.gen(function* () {
      // Fetch all projects from DB ordered by dirMtimeMs DESC
      const rows = db.select().from(projects).orderBy(desc(projects.dirMtimeMs)).all();

      if (rows.length === 0) {
        return { projects: [] };
      }

      const projectsList: Project[] = yield* Effect.all(
        rows.map((row) =>
          Effect.gen(function* () {
            const meta = yield* projectMetaService.getProjectMeta(row.id);
            return {
              id: row.id,
              claudeProjectPath: row.path ?? decodeProjectId(row.id),
              lastModifiedAt: new Date(row.dirMtimeMs),
              meta,
            } satisfies Project;
          }),
        ),
        { concurrency: "unbounded" },
      );

      return { projects: projectsList };
    });

  return {
    getProject,
    getProjects,
  };
});

export type IProjectRepository = InferEffect<typeof LayerImpl>;
export class ProjectRepository extends Context.Tag("ProjectRepository")<
  ProjectRepository,
  IProjectRepository
>() {
  static Live = Layer.effect(this, LayerImpl);
}

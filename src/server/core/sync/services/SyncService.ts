import { FileSystem, Path } from "@effect/platform";
import { count, eq } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { DrizzleService } from "../../../lib/db/DrizzleService.ts";
import { projects, sessions } from "../../../lib/db/schema.ts";
import { ApplicationContext } from "../../platform/services/ApplicationContext.ts";
import { decodeProjectId, encodeProjectId } from "../../project/functions/id.ts";
import { extractSearchableText } from "../../search/functions/extractSearchableText.ts";
import { aggregateTokenUsageAndCost } from "../../session/functions/aggregateTokenUsageAndCost.ts";
import { extractSessionTitle } from "../../session/functions/extractSessionTitle.ts";
import { extractFirstUserMessage } from "../../session/functions/isValidFirstMessage.ts";
import { canonicalizeProjectPath } from "../../source/functions/canonicalizeProjectPath.ts";
import type { SourceAdapter, SourceEnv } from "../../source/models/SourceAdapter.ts";
import type {
  SourceProject,
  SourceSession,
  SourceSessionRef,
} from "../../source/models/SourceEntities.ts";
import { SourceRegistry } from "../../source/services/SourceRegistry.ts";

/**
 * Reads every enabled source into the cache database.
 *
 * The engine itself knows nothing about any CLI's layout or transcript format:
 * adapters discover projects and sessions and hand back conversation entries,
 * and everything here — titles, first messages, cost, the search index, row
 * lifecycle — is the same for all of them.
 */
export type ISyncService = {
  readonly fullSync: () => Effect.Effect<void, Error>;
  readonly syncSession: (projectId: string, sessionId: string) => Effect.Effect<void, Error>;
  readonly syncProjectList: (projectId: string) => Effect.Effect<void, Error>;
};

const LayerImpl = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const drizzleService = yield* DrizzleService;
  const registry = yield* SourceRegistry;
  const applicationContext = yield* ApplicationContext;

  const { db, rawDb } = drizzleService;

  // Adapters declare what they need; the engine hands them the one runtime it
  // was built with, so the service itself stays free of those requirements.
  const sourceEnv = Layer.mergeAll(
    Layer.succeed(FileSystem.FileSystem, fs),
    Layer.succeed(Path.Path, path),
    Layer.succeed(ApplicationContext, applicationContext),
  );

  const withEnv = <A, E>(effect: Effect.Effect<A, E, SourceEnv>): Effect.Effect<A, E> =>
    effect.pipe(Effect.provide(sourceEnv));

  const canonicalize = (projectPath: string | null) =>
    Effect.gen(function* () {
      const claudeCodePaths = yield* applicationContext.claudeCodePaths;
      return canonicalizeProjectPath(projectPath, {
        homeDirectory: path.dirname(claudeCodePaths.globalClaudeDirectoryPath),
        platform: process.platform,
      });
    });

  // -------------------------------------------------------------------------
  // Writing one session
  // -------------------------------------------------------------------------

  const upsertSession = (projectId: string, session: SourceSession): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      const { ref, entries } = session;

      let firstUserMessage = null;
      for (const entry of entries) {
        const message = extractFirstUserMessage(entry);
        if (message !== undefined) {
          firstUserMessage = message;
          break;
        }
      }

      const customTitle = extractSessionTitle(entries);

      const prLinksMap = new Map<
        string,
        { prNumber: number; prUrl: string; prRepository: string }
      >();
      for (const entry of entries) {
        if (entry.type === "pr-link") {
          prLinksMap.set(`${entry.prRepository}#${entry.prNumber}`, {
            prNumber: entry.prNumber,
            prUrl: entry.prUrl,
            prRepository: entry.prRepository,
          });
        }
      }
      const prLinks = [...prLinksMap.values()];

      const { totalCost, modelName } = aggregateTokenUsageAndCost([...session.usageTexts]);

      const now = Date.now();

      const projectStat = yield* fs
        .stat(ref.projectStoragePath)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));
      const projectDirMtimeMs =
        projectStat === null ? 0 : Option.getOrElse(projectStat.mtime, () => new Date(0)).getTime();

      const ftsEntries: Array<{ role: string; content: string; index: number }> = [];
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        if (entry === undefined) continue;
        const text = extractSearchableText(entry);
        if (text !== null && text.trim() !== "") {
          ftsEntries.push({ role: entry.type, content: text, index });
        }
      }

      const row = {
        projectId,
        source: ref.sourceId,
        sourceSessionKey: ref.sourceSessionKey,
        filePath: ref.filePath,
        messageCount: session.messageCount,
        firstUserMessageJson: firstUserMessage !== null ? JSON.stringify(firstUserMessage) : null,
        customTitle,
        totalCostUsd: totalCost.totalUsd,
        costBreakdownJson: JSON.stringify(totalCost.breakdown),
        tokenUsageJson: JSON.stringify(totalCost.tokenUsage),
        modelName,
        prLinksJson: prLinks.length > 0 ? JSON.stringify(prLinks) : null,
        fileMtimeMs: ref.fileMtimeMs,
        lastModifiedAt: new Date(ref.fileMtimeMs).toISOString(),
        syncedAt: now,
      };

      db.transaction((tx) => {
        tx.insert(sessions)
          .values({ id: ref.sessionId, ...row })
          .onConflictDoUpdate({ target: sessions.id, set: row })
          .run();

        rawDb.prepare("DELETE FROM session_messages_fts WHERE session_id = ?").run(ref.sessionId);

        for (const entry of ftsEntries) {
          rawDb
            .prepare(
              `INSERT INTO session_messages_fts (session_id, project_id, role, content, conversation_index)
             VALUES (?, ?, ?, ?, ?)`,
            )
            .run(ref.sessionId, projectId, entry.role, entry.content, entry.index);
        }

        tx.update(projects)
          .set({ dirMtimeMs: projectDirMtimeMs, syncedAt: now })
          .where(eq(projects.id, projectId))
          .run();
      });
    });

  const readAndUpsert = (
    adapter: SourceAdapter,
    projectId: string,
    ref: SourceSessionRef,
  ): Effect.Effect<void, Error> =>
    withEnv(adapter.readSession(ref)).pipe(
      Effect.mapError((error) => new Error(error.reason)),
      Effect.flatMap((session) => upsertSession(projectId, session)),
      Effect.catchAll((error) =>
        Effect.logError(`[SyncService] Failed to upsert session ${ref.filePath}: ${String(error)}`),
      ),
    );

  // -------------------------------------------------------------------------
  // Project rows
  // -------------------------------------------------------------------------

  const updateProjectSessionCount = (projectId: string): void => {
    const result = db
      .select({ cnt: count() })
      .from(sessions)
      .where(eq(sessions.projectId, projectId))
      .get();
    db.update(projects)
      .set({ sessionCount: result?.cnt ?? 0 })
      .where(eq(projects.id, projectId))
      .run();
  };

  const insertProjectRow = (adapter: SourceAdapter, project: SourceProject) =>
    Effect.gen(function* () {
      const cwd = project.cwd ?? (yield* withEnv(adapter.resolveProjectCwd(project)));

      db.insert(projects)
        .values({
          id: encodeProjectId(project.storagePath),
          name: cwd !== null ? path.basename(cwd) : null,
          path: cwd,
          source: adapter.id,
          sourceProjectKey: project.sourceProjectKey,
          canonicalPath: yield* canonicalize(cwd),
          sessionCount: 0,
          dirMtimeMs: project.dirMtimeMs,
          syncedAt: Date.now(),
        })
        .onConflictDoNothing()
        .run();
    });

  // -------------------------------------------------------------------------
  // Syncing one project
  // -------------------------------------------------------------------------

  const needsResync = (
    adapter: SourceAdapter,
    ref: SourceSessionRef,
    cached: { fileMtimeMs: number; customTitle: string | null } | undefined,
  ): Effect.Effect<boolean> => {
    if (cached === undefined) {
      return Effect.succeed(true);
    }
    if (ref.fileMtimeMs > cached.fileMtimeMs) {
      return Effect.succeed(true);
    }

    return adapter.shouldForceResync === undefined
      ? Effect.succeed(false)
      : withEnv(adapter.shouldForceResync(ref, cached.customTitle));
  };

  const syncProject = (adapter: SourceAdapter, project: SourceProject) =>
    Effect.gen(function* () {
      const projectId = encodeProjectId(project.storagePath);

      const existingProject = db.select().from(projects).where(eq(projects.id, projectId)).get();
      if (existingProject === undefined) {
        yield* insertProjectRow(adapter, project);
      } else if (existingProject.canonicalPath === null && existingProject.path !== null) {
        // Written before the column existed; no I/O needed to fill it in.
        db.update(projects)
          .set({ canonicalPath: yield* canonicalize(existingProject.path) })
          .where(eq(projects.id, projectId))
          .run();
      }

      const refs = yield* withEnv(adapter.listSessions(project)).pipe(
        Effect.catchAll(() => Effect.succeed<readonly SourceSessionRef[]>([])),
      );

      const knownSessions = db
        .select()
        .from(sessions)
        .where(eq(sessions.projectId, projectId))
        .all();
      const seenFilePaths = new Set<string>();

      for (const ref of refs) {
        seenFilePaths.add(ref.filePath);

        const cached = knownSessions.find((session) => session.filePath === ref.filePath);
        if (yield* needsResync(adapter, ref, cached)) {
          yield* readAndUpsert(adapter, projectId, ref);
        }
      }

      for (const knownSession of knownSessions) {
        if (!seenFilePaths.has(knownSession.filePath)) {
          db.delete(sessions).where(eq(sessions.filePath, knownSession.filePath)).run();
          rawDb
            .prepare("DELETE FROM session_messages_fts WHERE session_id = ?")
            .run(knownSession.id);
        }
      }

      updateProjectSessionCount(projectId);

      db.update(projects)
        .set({ dirMtimeMs: project.dirMtimeMs, syncedAt: Date.now() })
        .where(eq(projects.id, projectId))
        .run();

      return projectId;
    });

  // -------------------------------------------------------------------------
  // Entry points
  // -------------------------------------------------------------------------

  const fullSync = (): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      const adapters = yield* registry.enabled();

      const knownProjectIds = new Set(
        db
          .select({ id: projects.id })
          .from(projects)
          .all()
          .map((project) => project.id),
      );
      const seenProjectIds = new Set<string>();

      for (const adapter of adapters) {
        const sourceProjects = yield* withEnv(adapter.listProjects()).pipe(
          Effect.catchAll(() => Effect.succeed<readonly SourceProject[]>([])),
        );

        for (const project of sourceProjects) {
          seenProjectIds.add(yield* syncProject(adapter, project));
        }
      }

      for (const knownProjectId of knownProjectIds) {
        if (!seenProjectIds.has(knownProjectId)) {
          db.delete(sessions).where(eq(sessions.projectId, knownProjectId)).run();
          rawDb
            .prepare("DELETE FROM session_messages_fts WHERE project_id = ?")
            .run(knownProjectId);
          db.delete(projects).where(eq(projects.id, knownProjectId)).run();
        }
      }
    });

  /** Resolves the adapter owning a project, falling back to the first enabled one. */
  const adapterForProject = (projectId: string) =>
    Effect.gen(function* () {
      const adapters = yield* registry.enabled();
      for (const adapter of adapters) {
        const roots = yield* withEnv(adapter.watchRoots());
        if (roots.some((root) => projectId !== "" && decodeProjectId(projectId).startsWith(root))) {
          return adapter;
        }
      }
      return adapters.at(0);
    });

  const syncSession = (projectId: string, sessionId: string): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      const adapter = yield* adapterForProject(projectId);
      if (adapter === undefined) {
        return;
      }

      const storagePath = decodeProjectId(projectId);
      const ref = yield* withEnv(adapter.resolveSessionRef(storagePath, sessionId)).pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      );

      if (ref === null) {
        db.delete(sessions).where(eq(sessions.id, sessionId)).run();
        rawDb.prepare("DELETE FROM session_messages_fts WHERE session_id = ?").run(sessionId);
        updateProjectSessionCount(projectId);
        return;
      }

      const cached = db
        .select({ fileMtimeMs: sessions.fileMtimeMs, customTitle: sessions.customTitle })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .get();

      if (!(yield* needsResync(adapter, ref, cached))) {
        return;
      }

      yield* readAndUpsert(adapter, projectId, ref);
      updateProjectSessionCount(projectId);
    });

  const syncProjectList = (projectId: string): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      const adapter = yield* adapterForProject(projectId);
      if (adapter === undefined) {
        return;
      }

      const storagePath = decodeProjectId(projectId);
      const sourceProjects = yield* withEnv(adapter.listProjects()).pipe(
        Effect.catchAll(() => Effect.succeed<readonly SourceProject[]>([])),
      );

      const project = sourceProjects.find((candidate) => candidate.storagePath === storagePath);
      if (project === undefined) {
        return;
      }

      yield* syncProject(adapter, project);
    });

  return {
    fullSync,
    syncSession,
    syncProjectList,
  } satisfies ISyncService;
});

export class SyncService extends Context.Tag("SyncService")<SyncService, ISyncService>() {
  static readonly Live = Layer.effect(this, LayerImpl);
}

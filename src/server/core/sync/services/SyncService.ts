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
import { type SourceId, sourceIdSchema } from "../../source/models/SourceId.ts";
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
  /** Reads every enabled source, or only the ones named. */
  readonly fullSync: (sourceIds?: readonly SourceId[]) => Effect.Effect<void, Error>;
  /** Forgets everything read from one source, without touching its files. */
  readonly purgeSource: (sourceId: SourceId) => Effect.Effect<void, Error>;
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

  // fullSync and purgeSource both rewrite whole swathes of the cache. Run
  // concurrently they interleave: a purge deletes rows a sync is still writing,
  // or a sync started before a source was disabled re-inserts everything the
  // purge removed. One at a time is enough, and cheap.
  const engineLock = yield* Effect.makeSemaphore(1);

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
      // The home directory, not the parent of the Claude directory: those are
      // the same folder only when `--claude-dir` was left alone.
      const homeDirectory = yield* applicationContext.homeDirectory;
      return canonicalizeProjectPath(projectPath, {
        homeDirectory,
        platform: applicationContext.platform,
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

      const scanned = aggregateTokenUsageAndCost([...session.usageTexts]);

      // A source that priced its own turns is believed over anything computed
      // here: it knows its provider's rates, and Lantern's table only holds
      // Anthropic's. A source that counts tokens without pricing them still
      // reports the counts, and the cost stays unknown rather than being
      // guessed from the wrong table.
      const reported = session.reportedUsage;
      const { totalCost, modelName } =
        reported === undefined
          ? scanned
          : {
              modelName: reported.modelName,
              totalCost: {
                totalUsd: reported.costUsd ?? 0,
                breakdown: {
                  inputTokensUsd: 0,
                  outputTokensUsd: 0,
                  cacheCreationUsd: 0,
                  cacheReadUsd: 0,
                },
                tokenUsage: {
                  inputTokens: reported.inputTokens,
                  outputTokens: reported.outputTokens,
                  cacheCreationTokens: reported.cacheCreationTokens,
                  cacheReadTokens: reported.cacheReadTokens,
                },
                confidence:
                  reported.costUsd === null ? ("unknown" as const) : ("reported" as const),
              },
            };

      const now = Date.now();

      const projectStat = yield* fs
        .stat(ref.projectStoragePath)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));

      // A source that partitions its history by date has no project directory
      // to take a timestamp from — its storage path is one the CLI will never
      // write — so the newest session stands in for one, exactly as the listing
      // computes it. Writing the failed stat's zero instead would date the
      // project to 1970 and sink it to the bottom of every list.
      const cachedDirMtimeMs =
        db
          .select({ dirMtimeMs: projects.dirMtimeMs })
          .from(projects)
          .where(eq(projects.id, projectId))
          .get()?.dirMtimeMs ?? 0;
      const projectDirMtimeMs =
        projectStat === null
          ? Math.max(cachedDirMtimeMs, ref.fileMtimeMs)
          : Option.getOrElse(projectStat.mtime, () => new Date(0)).getTime();

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
        nativeCostUsd: reported?.costUsd ?? null,
        costBreakdownJson: JSON.stringify(totalCost.breakdown),
        tokenUsageJson: JSON.stringify(totalCost.tokenUsage),
        modelName,
        costConfidence: totalCost.confidence,
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

  const runFullSync = (sourceIds?: readonly SourceId[]): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      const enabledAdapters = yield* registry.enabled();
      const adapters =
        sourceIds === undefined
          ? enabledAdapters
          : enabledAdapters.filter((adapter) => sourceIds.includes(adapter.id));

      const syncedSourceIds = new Set<string>(adapters.map((adapter) => adapter.id));
      const knownProjectSources = new Map<string, string>();
      const sourceOf = (projectId: string) => knownProjectSources.get(projectId) ?? "";
      const knownProjectIds = new Set(
        db
          .select({ id: projects.id, source: projects.source })
          .from(projects)
          .all()
          // Only rows belonging to a source in this pass can be judged missing;
          // a scoped sync knows nothing about the others.
          .filter((project) => syncedSourceIds.has(project.source))
          .map((project) => {
            knownProjectSources.set(project.id, project.source);
            return project.id;
          }),
      );
      const seenProjectIds = new Set<string>();

      // A source that could not be listed says nothing about what it holds, so
      // its rows must not be judged missing. Without this, an unreadable or
      // not-yet-mounted history directory silently wipes that source's cache.
      const listedSourceIds = new Set<string>();

      for (const adapter of adapters) {
        const sourceProjects = yield* withEnv(adapter.listProjects()).pipe(
          Effect.map((listed) => ({ listed, ok: true })),
          Effect.catchAll((error) =>
            Effect.logWarning(`Could not list ${adapter.id} projects: ${String(error)}`).pipe(
              Effect.as({ listed: [] as readonly SourceProject[], ok: false }),
            ),
          ),
        );

        if (!sourceProjects.ok) {
          continue;
        }
        listedSourceIds.add(adapter.id);

        for (const project of sourceProjects.listed) {
          seenProjectIds.add(yield* syncProject(adapter, project));
        }
      }

      for (const knownProjectId of knownProjectIds) {
        if (!seenProjectIds.has(knownProjectId) && listedSourceIds.has(sourceOf(knownProjectId))) {
          db.delete(sessions).where(eq(sessions.projectId, knownProjectId)).run();
          rawDb
            .prepare("DELETE FROM session_messages_fts WHERE project_id = ?")
            .run(knownProjectId);
          db.delete(projects).where(eq(projects.id, knownProjectId)).run();
        }
      }
    });

  const runPurgeSource = (sourceId: SourceId): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      const projectIds = db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.source, sourceId))
        .all()
        .map((project) => project.id);

      for (const projectId of projectIds) {
        // The session rows go with the project by cascade, but the search index
        // is a virtual table with no foreign keys of its own.
        rawDb.prepare("DELETE FROM session_messages_fts WHERE project_id = ?").run(projectId);
      }

      db.delete(sessions).where(eq(sessions.source, sourceId)).run();
      db.delete(projects).where(eq(projects.source, sourceId)).run();

      yield* Effect.logInfo(`Forgot ${projectIds.length} ${sourceId} projects`);
    });

  const fullSync = (sourceIds?: readonly SourceId[]): Effect.Effect<void, Error> =>
    engineLock.withPermits(1)(runFullSync(sourceIds));

  const purgeSource = (sourceId: SourceId): Effect.Effect<void, Error> =>
    engineLock.withPermits(1)(runPurgeSource(sourceId));

  /**
   * The adapter that recorded a project, from the row itself.
   *
   * Guessing here is destructive: syncSession deletes a session it cannot
   * locate, so handing it the wrong adapter deletes another source's row.
   */
  const adapterForProject = (projectId: string): SourceAdapter | undefined => {
    const row = db
      .select({ source: projects.source })
      .from(projects)
      .where(eq(projects.id, projectId))
      .get();

    if (row === undefined) {
      return undefined;
    }

    const parsed = sourceIdSchema.safeParse(row.source);
    return parsed.success ? registry.get(parsed.data) : undefined;
  };

  const syncSession = (projectId: string, sessionId: string): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      const adapter = adapterForProject(projectId);
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
      const adapter = adapterForProject(projectId);
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
    purgeSource,
    syncSession,
    syncProjectList,
  } satisfies ISyncService;
});

export class SyncService extends Context.Tag("SyncService")<SyncService, ISyncService>() {
  static readonly Live = Layer.effect(this, LayerImpl);
}

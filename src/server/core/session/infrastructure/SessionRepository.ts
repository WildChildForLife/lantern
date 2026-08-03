import { FileSystem, Path } from "@effect/platform";
import { desc, eq, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DrizzleService } from "../../../lib/db/DrizzleService.ts";
import { projects, sessionTopics, sessions } from "../../../lib/db/schema.ts";
import type { InferEffect } from "../../../lib/effect/types.ts";
import { ApplicationContext } from "../../platform/services/ApplicationContext.ts";
import { decodeProjectId, validateProjectPath } from "../../project/functions/id.ts";
import type { SourceEnv } from "../../source/models/SourceAdapter.ts";
import { sourceIdSchema } from "../../source/models/SourceId.ts";
import { SourceRegistry } from "../../source/services/SourceRegistry.ts";
import { SyncService } from "../../sync/services/SyncService.ts";
import type { Session, SessionDetail } from "../../types.ts";
import {
  buildConversationListItem,
  isInternalSession,
  matchesConversationQuery,
} from "../functions/buildConversationListItem.ts";
import {
  groupConversationsWithAssignedTopics,
  topicIdFromLabel,
  type TopicRef,
  UNCATEGORIZED_TOPIC,
} from "../functions/groupConversationsByTopic.ts";
import { validateSessionId } from "../functions/id.ts";
import { SessionMetaService } from "../services/SessionMetaService.ts";

const LayerImpl = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const sessionMetaService = yield* SessionMetaService;
  const appContext = yield* ApplicationContext;
  const { db } = yield* DrizzleService;
  const syncService = yield* SyncService;
  const registry = yield* SourceRegistry;
  const path = yield* Path.Path;

  // Adapters declare what they need; this service hands them the runtime it was
  // built with, so its own signatures stay free of those requirements.
  const withEnv = <A, E>(effect: Effect.Effect<A, E, SourceEnv>): Effect.Effect<A, E> =>
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(FileSystem.FileSystem, fs),
          Layer.succeed(Path.Path, path),
          Layer.succeed(ApplicationContext, appContext),
        ),
      ),
    );

  /**
   * The adapter that owns a session, from the cache.
   *
   * The session row is the better answer, but a session can be on disk before
   * it has been synced — opening a conversation the moment it starts — so the
   * project it sits in stands in when there is no session row yet.
   */
  const adapterFor = (projectId: string, sessionId: string) => {
    const sessionRow = db
      .select({ source: sessions.source })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get();

    const projectRow = db
      .select({ source: projects.source })
      .from(projects)
      .where(eq(projects.id, projectId))
      .get();

    const parsed = sourceIdSchema.safeParse(sessionRow?.source ?? projectRow?.source);
    return parsed.success ? registry.get(parsed.data) : undefined;
  };

  const getSession = (projectId: string, sessionId: string) =>
    Effect.gen(function* () {
      if (!validateSessionId(sessionId)) {
        return yield* Effect.fail(new Error("Invalid session ID: contains unsafe characters"));
      }

      const projectPath = decodeProjectId(projectId);
      const { claudeProjectsDirPath } = yield* appContext.claudeCodePaths;

      // Which file holds a session, and which dialect it is written in, both
      // depend on the source. Deriving the path from the ids only ever
      // described Claude Code's layout.
      const adapter = adapterFor(projectId, sessionId);
      if (adapter === undefined) {
        return { session: null };
      }

      if (
        adapter.id === "claude-code" &&
        !validateProjectPath(projectPath, claudeProjectsDirPath)
      ) {
        return yield* Effect.fail(new Error("Invalid project path: outside allowed directory"));
      }

      const ref = yield* withEnv(adapter.resolveSessionRef(projectPath, sessionId)).pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      );
      if (ref === null) {
        return { session: null };
      }

      const read = yield* withEnv(adapter.readSession(ref)).pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      );
      if (read === null) {
        return { session: null };
      }

      const meta = yield* sessionMetaService.getSessionMeta(projectId, sessionId);

      const sessionDetail: SessionDetail = {
        id: sessionId,
        jsonlFilePath: ref.filePath,
        meta,
        conversations: [...read.entries],
        lastModifiedAt: new Date(ref.fileMtimeMs),
      };

      return { session: sessionDetail };
    });

  const getSessions = (
    projectId: string,
    options?: {
      maxCount?: number;
      cursor?: string;
    },
  ) =>
    Effect.gen(function* () {
      const { maxCount = 20, cursor } = options ?? {};

      const claudeProjectPath = decodeProjectId(projectId);

      // Validate that the project path is within the Claude projects directory
      const { claudeProjectsDirPath } = yield* appContext.claudeCodePaths;
      if (!validateProjectPath(claudeProjectPath, claudeProjectsDirPath)) {
        return yield* Effect.fail(new Error("Invalid project path: outside allowed directory"));
      }

      // Ensure project is synced in DB
      const projectExists = db
        .select({ one: sql<number>`1` })
        .from(projects)
        .where(eq(projects.id, projectId))
        .get();
      if (!projectExists) {
        yield* syncService.syncProjectList(projectId).pipe(Effect.catchAll(() => Effect.void));
      }

      // Fetch all sessions for project ordered by lastModifiedAt DESC
      const rows = db
        .select()
        .from(sessions)
        .where(eq(sessions.projectId, projectId))
        .orderBy(desc(sessions.lastModifiedAt))
        .all();

      if (rows.length === 0) {
        return { sessions: [] };
      }

      // Cursor-based pagination
      const startIndex =
        cursor !== undefined
          ? (() => {
              const idx = rows.findIndex((r) => r.id === cursor);
              return idx === -1 ? 0 : idx + 1;
            })()
          : 0;

      const sessionsToReturn = rows.slice(startIndex, startIndex + maxCount);

      const sessionsResult: Session[] = yield* Effect.all(
        sessionsToReturn.map((row) =>
          Effect.gen(function* () {
            const meta = yield* sessionMetaService.getSessionMeta(projectId, row.id);
            return {
              id: row.id,
              jsonlFilePath: row.filePath,
              lastModifiedAt: new Date(row.lastModifiedAt),
              meta,
            } satisfies Session;
          }),
        ),
        { concurrency: "unbounded" },
      );

      return { sessions: sessionsResult };
    });

  /**
   * Every session across every project, newest first. Backs the flat
   * "All conversations" view, so it reads straight from the cache DB instead of
   * hydrating full session meta per row.
   */
  const readAllConversations = () =>
    db
      .select({
        sessionId: sessions.id,
        projectId: sessions.projectId,
        source: sessions.source,
        projectName: projects.name,
        projectPath: projects.path,
        customTitle: sessions.customTitle,
        firstUserMessageJson: sessions.firstUserMessageJson,
        messageCount: sessions.messageCount,
        lastModifiedAt: sessions.lastModifiedAt,
        modelName: sessions.modelName,
        totalCostUsd: sessions.totalCostUsd,
        costConfidence: sessions.costConfidence,
      })
      .from(sessions)
      .innerJoin(projects, eq(sessions.projectId, projects.id))
      .orderBy(desc(sessions.lastModifiedAt))
      .all()
      .map(buildConversationListItem)
      .filter((item) => !isInternalSession(item));

  /** Topics Claude assigned during a classification pass, keyed by session. */
  const readAssignedTopics = (): Record<string, TopicRef> => {
    const assigned: Record<string, TopicRef> = {};

    for (const row of db.select().from(sessionTopics).all()) {
      assigned[row.sessionId] = {
        id: topicIdFromLabel(row.label),
        label: row.label,
        icon: row.icon,
      };
    }

    return assigned;
  };

  const getAllConversations = (options?: {
    limit?: number;
    offset?: number;
    query?: string;
    topic?: string;
  }) =>
    Effect.sync(() => {
      const { limit = 50, offset = 0, query = "", topic } = options ?? {};

      // Topics are always derived from every conversation, so the grouping does
      // not change when the user narrows the list down.
      const items = readAllConversations();
      const { topicBySessionId } = groupConversationsWithAssignedTopics(
        items,
        readAssignedTopics(),
      );

      const entries = items
        .map((item) => ({
          ...item,
          topic: topicBySessionId[item.sessionId] ?? UNCATEGORIZED_TOPIC,
        }))
        .filter((entry) => topic === undefined || entry.topic.id === topic)
        .filter((entry) => matchesConversationQuery(entry, query));

      const page = entries.slice(offset, offset + limit);

      return {
        conversations: page,
        total: entries.length,
        nextOffset: offset + page.length < entries.length ? offset + page.length : undefined,
      };
    });

  /**
   * The topic groups themselves, for the landing page that replaces the
   * folder-based project grid.
   */
  const getConversationTopics = () =>
    Effect.sync(() => ({
      topics: groupConversationsWithAssignedTopics(readAllConversations(), readAssignedTopics())
        .topics,
    }));

  return {
    getSession,
    getSessions,
    getAllConversations,
    getConversationTopics,
  };
});

export type ISessionRepository = InferEffect<typeof LayerImpl>;

export class SessionRepository extends Context.Tag("SessionRepository")<
  SessionRepository,
  ISessionRepository
>() {
  static Live = Layer.effect(this, LayerImpl);
}

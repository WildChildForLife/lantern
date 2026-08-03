import { FileSystem, Path } from "@effect/platform";
import { eq } from "drizzle-orm";
import { Context, Data, Effect, Layer } from "effect";
import { DrizzleService } from "../../../lib/db/DrizzleService.ts";
import { sessions } from "../../../lib/db/schema.ts";
import { ApplicationContext } from "../../platform/services/ApplicationContext.ts";
import { validateProjectPath } from "../../project/functions/id.ts";
import { sourceIdSchema } from "../../source/models/SourceId.ts";
import { SourceRegistry } from "../../source/services/SourceRegistry.ts";
import { validateSessionId } from "../functions/id.ts";

export class SessionNotFoundError extends Data.TaggedError("SessionNotFoundError")<{
  readonly projectId: string;
  readonly sessionId: string;
}> {}

export class UnsafeSessionPathError extends Data.TaggedError("UnsafeSessionPathError")<{
  readonly filePath: string;
}> {}

export type SessionLocation = {
  readonly filePath: string;
  readonly sourceId: string;
  /** Whether Lantern may remove this file. False for every foreign source. */
  readonly deletable: boolean;
};

/**
 * Turns the ids the app passes around into a file on disk.
 *
 * Session ids used to imply their own path — `<projectDir>/<sessionId>.jsonl` —
 * which only holds for Claude Code. Other CLIs date-partition their storage, or
 * split one session across two directories, so the cached `file_path` is the
 * authority instead.
 *
 * Every path is re-checked against the directories the enabled sources actually
 * read before it is handed back. The ids arrive from the URL, and a resolved
 * path is used to read and to delete.
 */
export type ISessionLocatorService = {
  readonly locate: (
    projectId: string,
    sessionId: string,
  ) => Effect.Effect<SessionLocation, SessionNotFoundError | UnsafeSessionPathError>;
};

const LayerImpl = Effect.gen(function* () {
  const { db } = yield* DrizzleService;
  const registry = yield* SourceRegistry;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const applicationContext = yield* ApplicationContext;

  const sourceEnv = Layer.mergeAll(
    Layer.succeed(FileSystem.FileSystem, fs),
    Layer.succeed(Path.Path, path),
    Layer.succeed(ApplicationContext, applicationContext),
  );

  const allowedRoots = Effect.gen(function* () {
    const adapters = yield* registry.enabled();
    const roots: string[] = [];
    for (const adapter of adapters) {
      roots.push(...(yield* adapter.watchRoots()));
    }
    return roots;
  }).pipe(Effect.provide(sourceEnv));

  const locate = (projectId: string, sessionId: string) =>
    Effect.gen(function* () {
      if (!validateSessionId(sessionId)) {
        return yield* new SessionNotFoundError({ projectId, sessionId });
      }

      const row = db
        .select({
          filePath: sessions.filePath,
          projectId: sessions.projectId,
          source: sessions.source,
        })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .get();

      if (row === undefined || row.projectId !== projectId) {
        return yield* new SessionNotFoundError({ projectId, sessionId });
      }

      const roots = yield* allowedRoots;
      if (!validateProjectPath(row.filePath, roots)) {
        return yield* new UnsafeSessionPathError({ filePath: row.filePath });
      }

      const parsedSource = sourceIdSchema.safeParse(row.source);
      const adapter = parsedSource.success ? registry.get(parsedSource.data) : undefined;

      return {
        filePath: row.filePath,
        sourceId: row.source,
        deletable: adapter?.capabilities.deletable ?? false,
      } satisfies SessionLocation;
    });

  return { locate } satisfies ISessionLocatorService;
});

export class SessionLocatorService extends Context.Tag("SessionLocatorService")<
  SessionLocatorService,
  ISessionLocatorService
>() {
  static readonly Live = Layer.effect(this, LayerImpl);
}

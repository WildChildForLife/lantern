import { FileSystem, Path } from "@effect/platform";
import { eq } from "drizzle-orm";
import { Context, Data, Effect, Layer } from "effect";
import { DrizzleService } from "../../../lib/db/DrizzleService.ts";
import { sessions } from "../../../lib/db/schema.ts";
import { ApplicationContext } from "../../platform/services/ApplicationContext.ts";
import { validateProjectPath } from "../../project/functions/id.ts";
import { type SourceId, sourceIdSchema } from "../../source/models/SourceId.ts";
import { SourceRegistry } from "../../source/services/SourceRegistry.ts";
import { validateSessionId } from "../functions/id.ts";

export class SessionNotFoundError extends Data.TaggedError("SessionNotFoundError")<{
  readonly projectId: string;
  readonly sessionId: string;
}> {}

export class UnsafeSessionPathError extends Data.TaggedError("UnsafeSessionPathError")<{
  readonly filePath: string;
  readonly reason: "outside-source-roots" | "source-not-readable";
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
 * Every path is re-checked before it is handed back, against the roots of the
 * one source the row claims — not against every root Lantern reads. Checking
 * the union would let a row marked deletable pass on the strength of a
 * directory belonging to a source Lantern must never delete from. The ids
 * arrive from the URL, and a resolved path is used to read and to delete.
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

  // Roots come from the directory the server was started with, so they are
  // fixed for the process and resolved once. Every known adapter is included,
  // not only the enabled ones: disabling a source purges its rows, so a row
  // that still exists must still be checkable.
  const rootsBySource = new Map<SourceId, readonly string[]>();
  for (const adapter of registry.all) {
    rootsBySource.set(adapter.id, yield* adapter.watchRoots().pipe(Effect.provide(sourceEnv)));
  }

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

      const parsedSource = sourceIdSchema.safeParse(row.source);
      const adapter = parsedSource.success ? registry.get(parsedSource.data) : undefined;
      const roots = adapter === undefined ? undefined : rootsBySource.get(adapter.id);

      // A row whose source has no enabled adapter names no directory Lantern
      // reads, so there is nothing to validate its path against and no way to
      // serve the file. Refusing beats handing back an unchecked path.
      if (adapter === undefined || roots === undefined) {
        return yield* new UnsafeSessionPathError({
          filePath: row.filePath,
          reason: "source-not-readable",
        });
      }

      if (!validateProjectPath(row.filePath, roots)) {
        return yield* new UnsafeSessionPathError({
          filePath: row.filePath,
          reason: "outside-source-roots",
        });
      }

      return {
        filePath: row.filePath,
        sourceId: adapter.id,
        deletable: adapter.capabilities.deletable,
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

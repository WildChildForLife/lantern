import type { FileSystem, Path } from "@effect/platform";
import type { Effect } from "effect";
import type { ApplicationContext } from "../../platform/services/ApplicationContext.ts";
import type {
  SourceChange,
  SourceDetection,
  SourceProject,
  SourceReadError,
  SourceSession,
  SourceSessionGoneError,
  SourceSessionRef,
} from "./SourceEntities.ts";
import type { SourceId } from "./SourceId.ts";

/** Everything an adapter is allowed to depend on. */
export type SourceEnv = FileSystem.FileSystem | Path.Path | ApplicationContext;

export type SourceCapabilities = {
  /** Whether changes can be observed with a filesystem watch, or need polling. */
  readonly watch: boolean;
  /** Whether Lantern can start, resume or abort a turn for this source. */
  readonly interactive: boolean;
  /** Whether Lantern may delete this source's files. Never true by default. */
  readonly deletable: boolean;
  readonly cost: "reported" | "estimated" | "unknown";
};

/**
 * One agent CLI, as a session source.
 *
 * Adapters are plain values held by the registry rather than services, so the
 * rest of the server can iterate over them. They own everything specific to a
 * CLI's on-disk layout and transcript dialect; ingestion, indexing, grouping and
 * rendering stay generic.
 */
export type SourceAdapter = {
  readonly id: SourceId;
  /** Product name, shown as-is. A proper noun — never translated. */
  readonly displayName: string;
  readonly capabilities: SourceCapabilities;

  /**
   * Probe this machine. Must read and parse a real session before reporting
   * `supported: true` — assuming a format is how a whole history ends up
   * rendering blank while looking like it worked.
   */
  readonly detect: () => Effect.Effect<SourceDetection, never, SourceEnv>;

  readonly listProjects: () => Effect.Effect<readonly SourceProject[], SourceReadError, SourceEnv>;

  /**
   * The project's real working directory, for sources that cannot report it
   * cheaply while listing. Called only when a project is first recorded, since
   * for some sources it means parsing a transcript.
   */
  readonly resolveProjectCwd: (
    project: SourceProject,
  ) => Effect.Effect<string | null, never, SourceEnv>;

  readonly listSessions: (
    project: SourceProject,
  ) => Effect.Effect<readonly SourceSessionRef[], SourceReadError, SourceEnv>;

  readonly readSession: (
    ref: SourceSessionRef,
  ) => Effect.Effect<SourceSession, SourceReadError, SourceEnv>;

  /**
   * Locate a session from the ids Lantern hands around, without a database.
   * Superseded by the cache-backed locator once sessions carry their source.
   */
  readonly resolveSessionRef: (
    projectStoragePath: string,
    sessionId: string,
  ) => Effect.Effect<SourceSessionRef, SourceSessionGoneError, SourceEnv>;

  /**
   * Whether an unchanged file should be re-read anyway — Claude Code appends a
   * title to a transcript long after its last message, which no mtime check
   * catches. Absent means "trust the mtime".
   */
  readonly shouldForceResync?: (
    ref: SourceSessionRef,
    cachedCustomTitle: string | null,
  ) => Effect.Effect<boolean, never, SourceEnv>;

  /** Absolute directories the generic watcher should watch recursively. */
  readonly watchRoots: () => Effect.Effect<readonly string[], never, SourceEnv>;

  /**
   * Pure: map an absolute changed path to what needs re-syncing, or null when
   * the path is none of this source's business.
   */
  readonly classifyChange: (absolutePath: string, roots: readonly string[]) => SourceChange | null;
};

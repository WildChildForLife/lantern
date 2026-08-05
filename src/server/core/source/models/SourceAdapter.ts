import type { CommandExecutor, FileSystem, Path } from "@effect/platform";
import { Data, type Effect } from "effect";
import type { ApplicationContext } from "../../platform/services/ApplicationContext.ts";
import type { LanternOptionsService } from "../../platform/services/LanternOptionsService.ts";
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
   *
   * The two failures mean opposite things and must not be conflated. Gone is an
   * answer — the session is not there, and the cached row should go with it. A
   * read error is the absence of one: a source whose storage is momentarily
   * unreadable has said nothing about what it holds, and deleting on it throws
   * away a row that is still there.
   */
  readonly resolveSessionRef: (
    projectStoragePath: string,
    sessionId: string,
  ) => Effect.Effect<SourceSessionRef, SourceSessionGoneError | SourceReadError, SourceEnv>;

  /**
   * Whether an unchanged file should be re-read anyway — Claude Code appends a
   * title to a transcript long after its last message, which no mtime check
   * catches. Absent means "trust the mtime".
   */
  readonly shouldForceResync?: (
    ref: SourceSessionRef,
    cachedCustomTitle: string | null,
  ) => Effect.Effect<boolean, never, SourceEnv>;

  /**
   * Every absolute directory this source's files can live under.
   *
   * Two jobs, and they must not be conflated. The watcher watches these, but
   * only for a source whose `capabilities.watch` is set. Path validation checks
   * resolved paths against them for *every* source, watched or not — so a
   * source that is only ever polled still has to name its directories. An empty
   * list means no path can be proven safe, and every session becomes
   * unreadable.
   */
  readonly roots: () => Effect.Effect<readonly string[], never, SourceEnv>;

  /**
   * Pure: map an absolute changed path to what needs re-syncing, or null when
   * the path is none of this source's business.
   */
  readonly classifyChange: (absolutePath: string, roots: readonly string[]) => SourceChange | null;

  /**
   * How to ask this CLI one question without a terminal.
   *
   * Topic naming runs through whichever CLI the user picked, using the login
   * they already have — Lantern never holds a key of its own. Absent means the
   * CLI offers no headless mode, and naming falls back to the local keyword
   * grouping rather than failing.
   */
  readonly headless?: HeadlessRunner;
};

/**
 * What resolving and running a CLI needs, on top of what reading files needs:
 * a process to run `which`, and the options that can name an executable
 * outright.
 */
export type HeadlessEnv = SourceEnv | CommandExecutor.CommandExecutor | LanternOptionsService;

export type HeadlessAnswer = {
  readonly text: string;
  /** What the CLI said the call cost, when it says. Zero when it does not. */
  readonly costUsd: number;
};

export type HeadlessRunner = {
  /**
   * Absolute path to the CLI. Wider than `SourceEnv` because finding a binary
   * means running `which`, which reading a directory does not.
   */
  readonly executable: () => Effect.Effect<string, HeadlessUnavailableError, HeadlessEnv>;
  /** Everything after the executable, for one non-interactive prompt. */
  readonly args: (prompt: string) => readonly string[];
  /**
   * Pull the answer out of stdout. Each CLI frames it differently, and some
   * only ever print prose — hence a per-source parse rather than one envelope.
   */
  readonly parse: (stdout: string) => HeadlessAnswer;
};

export class HeadlessUnavailableError extends Data.TaggedError("HeadlessUnavailableError")<{
  readonly sourceId: SourceId;
  readonly reason: string;
}> {}

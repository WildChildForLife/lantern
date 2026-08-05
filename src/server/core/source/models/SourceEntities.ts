import { Data } from "effect";
import type { ExtendedConversation } from "../../../../types/conversation.ts";
import type { SourceId } from "./SourceId.ts";

/**
 * A project as one source sees it: the directory that source keeps the logs in,
 * plus the real working directory when the format records one.
 */
export type SourceProject = {
  readonly sourceId: SourceId;
  /** Directory holding this project's session files, as stored by the source. */
  readonly storagePath: string;
  /** The project's actual working directory, or null when the source omits it. */
  readonly cwd: string | null;
  /** Stable identifier for this project within the source. */
  readonly sourceProjectKey: string;
  readonly dirMtimeMs: number;
};

/** Enough to locate and stat one session without reading it. */
export type SourceSessionRef = {
  readonly sourceId: SourceId;
  /** Lantern's session id — unique across all sources. */
  readonly sessionId: string;
  /** Storage path of the owning project, matching `SourceProject.storagePath`. */
  readonly projectStoragePath: string;
  /** Absolute path of the session's primary file. */
  readonly filePath: string;
  readonly fileMtimeMs: number;
  /** The source's own identifier for this session. */
  readonly sourceSessionKey: string;
};

/**
 * How a source's transcript was read.
 *
 * `ignored` and `unparsed` are counted apart on purpose. Unrecognised lines are
 * never dropped silently — a wrong format assumption has to surface as a count
 * rather than as a history that renders blank — but a line an adapter has
 * decided not to render is not evidence of anything, and folding the two
 * together would bury the signal in it.
 */
export type ParseStats = {
  readonly total: number;
  readonly ignored: number;
  readonly unparsed: number;
};

/** One session, read and translated into Lantern's conversation entries. */
export type SourceSession = {
  readonly ref: SourceSessionRef;
  readonly entries: readonly ExtendedConversation[];
  /** Lines the source considers messages — drives the session's message count. */
  readonly messageCount: number;
  /**
   * Raw transcript texts (the session plus any sidecar files) that token and
   * cost aggregation scans. Transitional: adapters will report usage directly
   * once cost handling becomes provider-aware.
   */
  readonly usageTexts: readonly string[];
  readonly parseStats: ParseStats;
};

/** What a filesystem change under a source's roots means. */
export type SourceChange = {
  readonly sourceId: SourceId;
  readonly projectStoragePath: string;
  readonly sessionId: string;
  /** Set when the change is to a sidecar file (a subagent transcript). */
  readonly agentId: string | null;
};

export type UnsupportedReason =
  | "not-installed"
  | "no-data"
  | "sqlite-storage"
  | "unknown-shape"
  | "schema-changed";

/** The result of probing for a source on this machine. */
export type SourceDetection = {
  readonly sourceId: SourceId;
  /** Where this source keeps its history, or null when nothing was found. */
  readonly rootPath: string | null;
  readonly hasData: boolean;
  /** True only when a real session file was read and parsed, never assumed. */
  readonly supported: boolean;
  readonly unsupportedReason: UnsupportedReason | null;
};

export class SourceReadError extends Data.TaggedError("SourceReadError")<{
  readonly sourceId: SourceId;
  readonly path: string;
  readonly reason: string;
  readonly cause?: unknown;
}> {}

/** A session the source no longer holds — normal, not a failure. */
export class SourceSessionGoneError extends Data.TaggedError("SourceSessionGoneError")<{
  readonly sourceId: SourceId;
  readonly sessionId: string;
}> {}

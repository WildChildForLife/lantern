import { FileSystem, Path } from "@effect/platform";
import { Effect, Option } from "effect";
import { z } from "zod";
import { ApplicationContext } from "../../../platform/services/ApplicationContext.ts";
import type { SourceAdapter } from "../../models/SourceAdapter.ts";
import {
  type SourceDetection,
  type SourceProject,
  SourceReadError,
  type SourceSession,
  SourceSessionGoneError,
  type SourceSessionRef,
} from "../../models/SourceEntities.ts";
import { OPENCODE_SOURCE_ID } from "../../models/SourceId.ts";
import { type MessageFile, parseMessages } from "./functions/parseMessages.ts";

/**
 * `<data>/opencode/storage`, laid out as one directory per kind:
 *
 *   project/<projectID>.json          the workspace, including its worktree
 *   session/<projectID>/<id>.json     the session, including its title and cost
 *   message/<sessionID>/<id>.json     one message per file
 *
 * Unlike Codex this gives a real per-project directory, so a project id is an
 * ordinary path and a session's file is an ordinary join onto it.
 */
const STORAGE_DIR = "storage";
const PROJECT_DIR = "project";
const SESSION_DIR = "session";
const MESSAGE_DIR = "message";

const projectFileSchema = z.looseObject({
  id: z.string(),
  worktree: z.string().optional(),
});

const sessionInfoSchema = z.looseObject({
  id: z.string(),
  projectID: z.string().optional(),
  title: z.string().optional(),
  parentID: z.string().optional(),
  time: z
    .looseObject({
      created: z.number().optional(),
      updated: z.number().optional(),
      archived: z.number().optional(),
    })
    .optional(),
});

/**
 * opencode.
 *
 * Read-only, and watched: its storage is a plain directory tree whose paths say
 * which session changed, so a pure function can classify a change.
 *
 * The one thing it does that no other source here does is write down what a
 * turn cost. Those numbers are taken as reported rather than recomputed —
 * opencode bills against providers Lantern has no price table for.
 *
 * Newer opencode versions keep the same data in a SQLite database beside this
 * tree. That is a separate storage mode rather than another dialect, and is not
 * read here: an installation that has moved to it reports as unsupported rather
 * than appearing empty.
 */
const makeAdapter = (): SourceAdapter => {
  const rootPath = Effect.gen(function* () {
    const path = yield* Path.Path;
    const context = yield* ApplicationContext;
    const configured = yield* context.sourceRoot(OPENCODE_SOURCE_ID);
    if (configured !== undefined) {
      return configured;
    }

    const home = yield* context.homeDirectory;
    // The XDG default, which is what opencode falls back to itself.
    return path.resolve(home ?? "/", ".local", "share", "opencode");
  });

  const storagePath = Effect.gen(function* () {
    const path = yield* Path.Path;
    return path.join(yield* rootPath, STORAGE_DIR);
  });

  const readJson = (filePath: string) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const content = yield* fs
        .readFileString(filePath)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));
      if (content === null) return null;

      try {
        return JSON.parse(content) as unknown;
      } catch {
        return null;
      }
    });

  /** Every `*.json` directly inside a directory, sorted by name. */
  const listJsonFiles = (directory: string) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const names = yield* fs
        .readDirectory(directory)
        .pipe(Effect.catchAll(() => Effect.succeed<string[]>([])));

      return names.filter((name) => name.endsWith(".json")).sort();
    });

  const listProjects = () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const storage = yield* storagePath;

      const projectDirectory = path.join(storage, PROJECT_DIR);
      const found: SourceProject[] = [];

      for (const name of yield* listJsonFiles(projectDirectory)) {
        const parsed = projectFileSchema.safeParse(
          yield* readJson(path.join(projectDirectory, name)),
        );
        if (!parsed.success) continue;

        // The sessions of a project live in a directory named for its id, and
        // that directory is the project as far as Lantern is concerned.
        const sessionDirectory = path.join(storage, SESSION_DIR, parsed.data.id);
        const stat = yield* fs
          .stat(sessionDirectory)
          .pipe(Effect.catchAll(() => Effect.succeed(null)));
        if (stat === null) continue;

        found.push({
          sourceId: OPENCODE_SOURCE_ID,
          storagePath: sessionDirectory,
          // A project with no worktree recorded is one opencode never ran in a
          // directory; grouping it by a guess would be worse than not grouping.
          cwd: parsed.data.worktree ?? null,
          sourceProjectKey: parsed.data.id,
          dirMtimeMs: Option.getOrElse(stat.mtime, () => new Date(0)).getTime(),
        });
      }

      return found;
    });

  const resolveProjectCwd = (project: SourceProject) => Effect.succeed(project.cwd);

  const listSessions = (project: SourceProject) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const refs: SourceSessionRef[] = [];
      for (const name of yield* listJsonFiles(project.storagePath)) {
        const filePath = path.join(project.storagePath, name);
        const stat = yield* fs.stat(filePath).pipe(Effect.catchAll(() => Effect.succeed(null)));
        if (stat === null) continue;

        refs.push({
          sourceId: OPENCODE_SOURCE_ID,
          sessionId: name.replace(/\.json$/, ""),
          projectStoragePath: project.storagePath,
          filePath,
          fileMtimeMs: Option.getOrElse(stat.mtime, () => new Date(0)).getTime(),
          sourceSessionKey: name.replace(/\.json$/, ""),
        });
      }

      return refs;
    });

  const readSession = (ref: SourceSessionRef) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const storage = yield* storagePath;

      const info = sessionInfoSchema.safeParse(yield* readJson(ref.filePath));
      if (!info.success) {
        return yield* new SourceReadError({
          sourceId: OPENCODE_SOURCE_ID,
          path: ref.filePath,
          reason: "session file did not parse",
        });
      }

      const messageDirectory = path.join(storage, MESSAGE_DIR, info.data.id);
      const files: MessageFile[] = [];
      // opencode ids sort chronologically, so the directory order is the
      // conversation order and nothing has to be sorted by timestamp.
      for (const name of yield* listJsonFiles(messageDirectory)) {
        // A file that did not parse is passed on rather than skipped. Dropping
        // it here would lose a message and count nothing, which is the shape of
        // a format change that looks like it worked.
        files.push({ fileName: name, json: yield* readJson(path.join(messageDirectory, name)) });
      }

      const parsed = parseMessages(files, {
        sessionKey: ref.sourceSessionKey,
        cwd: yield* projectCwdFor(ref.projectStoragePath),
        version: "unknown",
      });

      if (parsed.parseStats.unparsed > 0) {
        yield* Effect.logWarning(
          `${parsed.parseStats.unparsed} unreadable messages in ${messageDirectory}: ${parsed.unparsedFiles.join(" | ")}`,
        );
      }

      return {
        ref,
        entries: parsed.entries,
        messageCount: parsed.messageCount,
        // Nothing to scan: opencode records its own usage, which is better than
        // anything a scan of the transcript could reconstruct.
        usageTexts: [],
        reportedUsage: { ...parsed.usage, modelName: parsed.modelName },
        parseStats: parsed.parseStats,
      } satisfies SourceSession;
    });

  /**
   * The worktree a project ran in, from the project file its session directory
   * is named for.
   *
   * Entries carry a `cwd`, and getting it wrong is worse than leaving it empty:
   * it is what the viewer shows as the session's directory.
   */
  const projectCwdFor = (projectStoragePath: string) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const storage = yield* storagePath;
      const projectId = path.basename(projectStoragePath);

      const parsed = projectFileSchema.safeParse(
        yield* readJson(path.join(storage, PROJECT_DIR, `${projectId}.json`)),
      );

      return parsed.success ? (parsed.data.worktree ?? "") : "";
    });

  const resolveSessionRef = (projectStoragePath: string, sessionId: string) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const filePath = path.join(projectStoragePath, `${sessionId}.json`);
      const stat = yield* fs.stat(filePath).pipe(Effect.catchAll(() => Effect.succeed(null)));
      if (stat === null) {
        return yield* new SourceSessionGoneError({ sourceId: OPENCODE_SOURCE_ID, sessionId });
      }

      return {
        sourceId: OPENCODE_SOURCE_ID,
        sessionId,
        projectStoragePath,
        filePath,
        fileMtimeMs: Option.getOrElse(stat.mtime, () => new Date(0)).getTime(),
        sourceSessionKey: sessionId,
      } satisfies SourceSessionRef;
    });

  const detect = () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* rootPath;
      const storage = yield* storagePath;

      const exists = yield* fs.exists(root).pipe(Effect.catchAll(() => Effect.succeed(false)));
      if (!exists) {
        return {
          sourceId: OPENCODE_SOURCE_ID,
          rootPath: null,
          hasData: false,
          supported: false,
          unsupportedReason: "not-installed",
        } satisfies SourceDetection;
      }

      const projects = yield* listProjects();
      if (projects.length === 0) {
        return {
          sourceId: OPENCODE_SOURCE_ID,
          rootPath: root,
          hasData: false,
          supported: false,
          unsupportedReason: "no-data",
        } satisfies SourceDetection;
      }

      // Parse a real session rather than trusting the layout: an installation
      // that has moved its history into SQLite still has these directories, and
      // must report itself rather than render as an empty list.
      for (const project of projects) {
        const refs = yield* listSessions(project);
        const ref = refs.at(0);
        if (ref === undefined) continue;

        const info = sessionInfoSchema.safeParse(yield* readJson(ref.filePath));
        if (!info.success) continue;

        const messageDirectory = path.join(storage, MESSAGE_DIR, info.data.id);
        const names = yield* listJsonFiles(messageDirectory);
        if (names.length === 0) continue;

        const first = names.at(0);
        if (first === undefined) continue;

        const parsed = parseMessages(
          [{ fileName: first, json: yield* readJson(path.join(messageDirectory, first)) }],
          { sessionKey: info.data.id, cwd: project.cwd ?? "", version: "unknown" },
        );

        if (parsed.parseStats.unparsed === 0) {
          return {
            sourceId: OPENCODE_SOURCE_ID,
            rootPath: root,
            hasData: true,
            supported: true,
            unsupportedReason: null,
          } satisfies SourceDetection;
        }
      }

      return {
        sourceId: OPENCODE_SOURCE_ID,
        rootPath: root,
        hasData: true,
        supported: false,
        unsupportedReason: "unknown-shape",
      } satisfies SourceDetection;
    });

  /**
   * Pure: a changed path under `session/<projectID>/<sessionID>.json` names the
   * session directly. A changed message re-syncs the session it belongs to,
   * which its own path also names.
   */
  const classifyChange = (absolutePath: string, roots: readonly string[]) => {
    const root = roots.find((candidate) => absolutePath.startsWith(`${candidate}/`));
    if (root === undefined) return null;

    const relative = absolutePath.slice(root.length + 1).split("/");
    const [storage, kind, ...rest] = relative;
    if (storage !== STORAGE_DIR) return null;

    if (kind === SESSION_DIR && rest.length === 2) {
      const [projectId, fileName] = rest;
      if (projectId === undefined || fileName === undefined || !fileName.endsWith(".json")) {
        return null;
      }

      return {
        sourceId: OPENCODE_SOURCE_ID,
        projectStoragePath: `${root}/${STORAGE_DIR}/${SESSION_DIR}/${projectId}`,
        sessionId: fileName.replace(/\.json$/, ""),
        agentId: null,
      };
    }

    // A message names its session but not its project, and finding the project
    // means reading a file — which this must not do. The session file's own
    // mtime moves when a turn completes, so the re-sync happens then.
    return null;
  };

  return {
    id: OPENCODE_SOURCE_ID,
    displayName: "opencode",
    capabilities: {
      watch: true,
      interactive: false,
      deletable: false,
      cost: "reported",
    },
    detect,
    listProjects,
    resolveProjectCwd,
    listSessions,
    readSession,
    resolveSessionRef,
    roots: () => rootPath.pipe(Effect.map((root) => [root])),
    classifyChange,
  };
};

export const opencodeSourceAdapter = makeAdapter();

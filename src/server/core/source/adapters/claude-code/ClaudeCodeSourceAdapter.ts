import { FileSystem, Path } from "@effect/platform";
import { Effect, Option } from "effect";
import type { ExtendedConversation } from "../../../../../types/conversation.ts";
import { parseJsonl } from "../../../claude-code/functions/parseJsonl.ts";
import { ApplicationContext } from "../../../platform/services/ApplicationContext.ts";
import { encodeSessionId } from "../../../session/functions/id.ts";
import type { SourceAdapter } from "../../models/SourceAdapter.ts";
import {
  type SourceChange,
  type SourceDetection,
  type SourceProject,
  SourceReadError,
  type SourceSession,
  SourceSessionGoneError,
  type SourceSessionRef,
} from "../../models/SourceEntities.ts";
import { CLAUDE_CODE_SOURCE_ID } from "../../models/SourceId.ts";
import { extractProjectCwd } from "./functions/extractProjectCwd.ts";
import { getAgentSessionFilesForSession } from "./functions/getAgentSessionFilesForSession.ts";
import { isRegularSessionFile } from "./functions/isRegularSessionFile.ts";
import { parseSessionFilePath } from "./functions/parseSessionFilePath.ts";

const SESSION_FILE_EXTENSION = ".jsonl";

/** Claude Code stamps its own session id inside the transcript. */
const extractActualSessionId = (content: string): string | undefined => {
  const firstLine = content.split("\n").at(0);
  if (firstLine === undefined || firstLine.trim() === "") {
    return undefined;
  }

  const entry = parseJsonl(firstLine).at(0);
  if (entry === undefined || !("sessionId" in entry)) {
    return undefined;
  }

  return entry.sessionId;
};

const countMessageLines = (content: string): number =>
  content.split("\n").filter((line) => line.trim() !== "").length;

const readAgentTranscripts = (projectDirPath: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const actualSessionId = extractActualSessionId(content);
    if (actualSessionId === undefined) {
      return [];
    }

    const agentFilePaths = yield* getAgentSessionFilesForSession(
      projectDirPath,
      actualSessionId,
    ).pipe(Effect.catchAll(() => Effect.succeed<string[]>([])));

    const texts: string[] = [];
    for (const agentPath of agentFilePaths) {
      const agentContent = yield* fs
        .readFileString(agentPath)
        .pipe(Effect.catchAll(() => Effect.succeed("")));
      if (agentContent !== "") {
        texts.push(agentContent);
      }
    }

    return texts;
  });

/**
 * Claude Code's own sessions: one `.jsonl` per session inside a project
 * directory under `~/.claude/projects`, with subagent transcripts alongside.
 *
 * This adapter is the reference implementation of the seam — it is the only one
 * that is interactive, and the only one whose files Lantern may delete.
 */
const makeAdapter = (): SourceAdapter => {
  const projectsDirPath = Effect.gen(function* () {
    const context = yield* ApplicationContext;
    const paths = yield* context.claudeCodePaths;
    return paths.claudeProjectsDirPath;
  });

  const listProjects = () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const rootPath = yield* projectsDirPath;

      const rootExists = yield* fs
        .exists(rootPath)
        .pipe(Effect.catchAll(() => Effect.succeed(false)));
      if (!rootExists) {
        return [];
      }

      const dirNames = yield* fs
        .readDirectory(rootPath)
        .pipe(Effect.catchAll(() => Effect.succeed<string[]>([])));

      const projects: SourceProject[] = [];
      for (const dirName of dirNames) {
        const storagePath = path.join(rootPath, dirName);
        const dirStat = yield* fs
          .stat(storagePath)
          .pipe(Effect.catchAll(() => Effect.succeed(null)));
        if (dirStat === null || dirStat.type !== "Directory") {
          continue;
        }

        projects.push({
          sourceId: CLAUDE_CODE_SOURCE_ID,
          storagePath,
          // Deriving it means reading a transcript, so it is left to
          // resolveProjectCwd and paid for only once per project.
          cwd: null,
          sourceProjectKey: dirName,
          dirMtimeMs: Option.getOrElse(dirStat.mtime, () => new Date(0)).getTime(),
        });
      }

      return projects;
    });

  const resolveProjectCwd = (project: SourceProject) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const fileNames = yield* fs
        .readDirectory(project.storagePath)
        .pipe(Effect.catchAll(() => Effect.succeed<string[]>([])));

      return yield* extractProjectCwd(project.storagePath, fileNames.filter(isRegularSessionFile));
    });

  /**
   * A title written by `/title` or by the AI namer lands in the transcript
   * without changing anything the mtime comparison looks at.
   */
  const shouldForceResync = (ref: SourceSessionRef, cachedCustomTitle: string | null) =>
    Effect.gen(function* () {
      if (cachedCustomTitle !== null) {
        return false;
      }

      const fs = yield* FileSystem.FileSystem;
      const content = yield* fs
        .readFileString(ref.filePath)
        .pipe(Effect.catchAll(() => Effect.succeed("")));

      return /"type"\s*:\s*"ai-title"/.test(content);
    });

  const listSessions = (project: SourceProject) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const fileNames = yield* fs
        .readDirectory(project.storagePath)
        .pipe(Effect.catchAll(() => Effect.succeed<string[]>([])));

      const refs: SourceSessionRef[] = [];
      for (const fileName of fileNames.filter(isRegularSessionFile)) {
        const filePath = path.join(project.storagePath, fileName);
        const fileStat = yield* fs.stat(filePath).pipe(Effect.catchAll(() => Effect.succeed(null)));
        if (fileStat === null) {
          continue;
        }

        refs.push({
          sourceId: CLAUDE_CODE_SOURCE_ID,
          sessionId: encodeSessionId(filePath),
          projectStoragePath: project.storagePath,
          filePath,
          fileMtimeMs: Option.getOrElse(fileStat.mtime, () => new Date(0)).getTime(),
          sourceSessionKey: fileName,
        });
      }

      return refs;
    });

  const readSession = (ref: SourceSessionRef) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const content = yield* fs.readFileString(ref.filePath).pipe(
        Effect.mapError(
          (cause) =>
            new SourceReadError({
              sourceId: CLAUDE_CODE_SOURCE_ID,
              path: ref.filePath,
              reason: cause.message,
              cause,
            }),
        ),
      );

      const entries: readonly ExtendedConversation[] = parseJsonl(content);
      const agentTexts = yield* readAgentTranscripts(ref.projectStoragePath, content);

      return {
        ref,
        entries,
        messageCount: countMessageLines(content),
        usageTexts: [content, ...agentTexts],
        parseStats: {
          total: entries.length,
          ignored: 0,
          unparsed: entries.filter((entry) => entry.type === "x-error").length,
        },
      } satisfies SourceSession;
    });

  const resolveSessionRef = (projectStoragePath: string, sessionId: string) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const filePath = path.join(projectStoragePath, `${sessionId}${SESSION_FILE_EXTENSION}`);
      const fileStat = yield* fs.stat(filePath).pipe(Effect.catchAll(() => Effect.succeed(null)));
      if (fileStat === null) {
        return yield* new SourceSessionGoneError({
          sourceId: CLAUDE_CODE_SOURCE_ID,
          sessionId,
        });
      }

      return {
        sourceId: CLAUDE_CODE_SOURCE_ID,
        sessionId,
        projectStoragePath,
        filePath,
        fileMtimeMs: Option.getOrElse(fileStat.mtime, () => new Date(0)).getTime(),
        sourceSessionKey: `${sessionId}${SESSION_FILE_EXTENSION}`,
      } satisfies SourceSessionRef;
    });

  const detect = () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const rootPath = yield* projectsDirPath;

      const rootExists = yield* fs
        .exists(rootPath)
        .pipe(Effect.catchAll(() => Effect.succeed(false)));
      if (!rootExists) {
        return {
          sourceId: CLAUDE_CODE_SOURCE_ID,
          rootPath: null,
          hasData: false,
          supported: false,
          unsupportedReason: "not-installed",
        } satisfies SourceDetection;
      }

      const projects = yield* listProjects().pipe(Effect.catchAll(() => Effect.succeed([])));
      const firstProject = projects.at(0);
      if (firstProject === undefined) {
        return {
          sourceId: CLAUDE_CODE_SOURCE_ID,
          rootPath,
          hasData: false,
          supported: false,
          unsupportedReason: "no-data",
        } satisfies SourceDetection;
      }

      // Probe a real transcript rather than trusting the directory layout.
      const refs = yield* listSessions(firstProject).pipe(
        Effect.catchAll(() => Effect.succeed([])),
      );
      const firstRef = refs.at(0);
      const probe =
        firstRef === undefined
          ? null
          : yield* readSession(firstRef).pipe(Effect.catchAll(() => Effect.succeed(null)));

      const parsedSomething =
        probe !== null && probe.entries.some((entry) => entry.type !== "x-error");

      return {
        sourceId: CLAUDE_CODE_SOURCE_ID,
        rootPath,
        hasData: refs.length > 0,
        supported: parsedSomething,
        unsupportedReason: parsedSomething ? null : "unknown-shape",
      } satisfies SourceDetection;
    });

  const watchRoots = () => projectsDirPath.pipe(Effect.map((rootPath) => [rootPath]));

  const classifyChange = (absolutePath: string, roots: readonly string[]): SourceChange | null => {
    const root = roots.find((candidate) => absolutePath.startsWith(`${candidate}/`));
    if (root === undefined) {
      return null;
    }

    const match = parseSessionFilePath(absolutePath.slice(root.length + 1));
    if (match === null) {
      return null;
    }

    return match.type === "agent"
      ? {
          sourceId: CLAUDE_CODE_SOURCE_ID,
          projectStoragePath: `${root}/${match.projectId}`,
          sessionId: match.agentSessionId,
          agentId: match.agentSessionId,
        }
      : {
          sourceId: CLAUDE_CODE_SOURCE_ID,
          projectStoragePath: `${root}/${match.projectId}`,
          sessionId: match.sessionId,
          agentId: null,
        };
  };

  return {
    id: CLAUDE_CODE_SOURCE_ID,
    displayName: "Claude Code",
    capabilities: {
      watch: true,
      interactive: true,
      deletable: true,
      cost: "estimated",
    },
    detect,
    listProjects,
    resolveProjectCwd,
    listSessions,
    readSession,
    resolveSessionRef,
    shouldForceResync,
    watchRoots,
    classifyChange,
  };
};

export const claudeCodeSourceAdapter = makeAdapter();

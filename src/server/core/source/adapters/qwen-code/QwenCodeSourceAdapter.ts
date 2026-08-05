import { FileSystem, Path } from "@effect/platform";
import { Effect, Option } from "effect";
import { ApplicationContext } from "../../../platform/services/ApplicationContext.ts";
import { resolveOnPath } from "../../functions/resolveOnPath.ts";
import type { SourceAdapter } from "../../models/SourceAdapter.ts";
import {
  type SourceDetection,
  type SourceProject,
  SourceReadError,
  type SourceSession,
  SourceSessionGoneError,
  type SourceSessionRef,
} from "../../models/SourceEntities.ts";
import { QWEN_CODE_SOURCE_ID } from "../../models/SourceId.ts";
import { parseChat, readCwd } from "./functions/parseChat.ts";

/**
 * `~/.qwen`, laid out as:
 *
 *   projects/<encoded-cwd>/chats/<sessionID>.jsonl   the transcript
 *   projects/<encoded-cwd>/meta.json                 created/updated stamps
 *   usage_record.jsonl                               per-session token roll-up
 *
 * The project directory name is the working directory with its separators
 * replaced by dashes, the same lossy encoding Claude Code uses — `/work`
 * becomes `-work`. It is not decoded back: a directory whose own name contains
 * a dash is indistinguishable from a separator, and guessing wrong would file a
 * session under a workspace it never ran in. The real path is read from the
 * transcript instead, where Qwen Code stamps it on every record.
 */
/**
 * How many sessions `detect` will read before giving up.
 *
 * More than one, because an aborted session leaves a transcript with no
 * conversation in it and reading only the first would report a healthy install
 * as broken. Bounded, because the failing case must not cost a full scan.
 */
const DETECT_SAMPLE = 5;

const PROJECTS_DIR = "projects";
const CHATS_DIR = "chats";

/**
 * Qwen Code.
 *
 * A Gemini CLI fork, but not a Gemini CLI reader: current Gemini CLI keeps
 * sessions somewhere else entirely, in a replay log with rewind records, and
 * shares none of the envelope this parses. The two need separate adapters.
 *
 * Read-only, and watched: chats live in a plain directory tree whose paths name
 * the session that changed, so a pure function can classify a change.
 *
 * Tokens are taken as reported. Cost is not: Qwen Code is pointed at whichever
 * OpenAI-compatible provider the user configured, and Lantern's price table
 * only covers Anthropic's models.
 */
const makeAdapter = (): SourceAdapter => {
  const rootPath = Effect.gen(function* () {
    const path = yield* Path.Path;
    const context = yield* ApplicationContext;
    const configured = yield* context.sourceRoot(QWEN_CODE_SOURCE_ID);
    if (configured !== undefined) {
      return configured;
    }

    const home = yield* context.homeDirectory;
    return path.resolve(home ?? "/", ".qwen");
  });

  const projectsPath = Effect.gen(function* () {
    const path = yield* Path.Path;
    return path.join(yield* rootPath, PROJECTS_DIR);
  });

  /** Every `*.jsonl` directly inside a directory, sorted by name. */
  const listChatFiles = (directory: string) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const names = yield* fs
        .readDirectory(directory)
        .pipe(Effect.catchAll(() => Effect.succeed<string[]>([])));

      return names.filter((name) => name.endsWith(".jsonl")).sort();
    });

  const readLines = (filePath: string) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const content = yield* fs
        .readFileString(filePath)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));

      return content === null ? null : content.split("\n");
    });

  const listProjects = () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const projects = yield* projectsPath;

      const names = yield* fs
        .readDirectory(projects)
        .pipe(Effect.catchAll(() => Effect.succeed<string[]>([])));

      const found: SourceProject[] = [];

      for (const name of names.sort()) {
        // The chats directory is the project as far as Lantern is concerned:
        // a project directory also holds memory and cursor files, and only
        // this one holds sessions.
        const chats = path.join(projects, name, CHATS_DIR);
        const stat = yield* fs.stat(chats).pipe(Effect.catchAll(() => Effect.succeed(null)));
        if (stat === null) continue;

        found.push({
          sourceId: QWEN_CODE_SOURCE_ID,
          storagePath: chats,
          // Resolved from a transcript rather than from the directory name,
          // which cannot be decoded unambiguously.
          cwd: null,
          sourceProjectKey: name,
          dirMtimeMs: Option.getOrElse(stat.mtime, () => new Date(0)).getTime(),
        });
      }

      return found;
    });

  /**
   * The directory this project ran in, read from the first record that names
   * one.
   *
   * Every record carries `cwd`, so the first line of any transcript answers it.
   * Called only when a project is first recorded.
   */
  const resolveProjectCwd = (project: SourceProject) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;

      for (const name of yield* listChatFiles(project.storagePath)) {
        const lines = yield* readLines(path.join(project.storagePath, name));
        if (lines === null) continue;

        const cwd = readCwd(lines);
        if (cwd !== null) return cwd;
      }

      return null;
    });

  const listSessions = (project: SourceProject) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const refs: SourceSessionRef[] = [];
      for (const name of yield* listChatFiles(project.storagePath)) {
        const filePath = path.join(project.storagePath, name);
        const stat = yield* fs.stat(filePath).pipe(Effect.catchAll(() => Effect.succeed(null)));
        if (stat === null) continue;

        const sessionId = name.replace(/\.jsonl$/, "");
        refs.push({
          sourceId: QWEN_CODE_SOURCE_ID,
          sessionId,
          projectStoragePath: project.storagePath,
          filePath,
          fileMtimeMs: Option.getOrElse(stat.mtime, () => new Date(0)).getTime(),
          sourceSessionKey: sessionId,
        });
      }

      return refs;
    });

  const readSession = (ref: SourceSessionRef) =>
    Effect.gen(function* () {
      const lines = yield* readLines(ref.filePath);
      if (lines === null) {
        return yield* new SourceReadError({
          sourceId: QWEN_CODE_SOURCE_ID,
          path: ref.filePath,
          reason: "session file could not be read",
        });
      }

      const parsed = parseChat(lines, { sessionKey: ref.sourceSessionKey, cwd: "" });

      if (parsed.parseStats.unparsed > 0) {
        yield* Effect.logWarning(
          `${parsed.parseStats.unparsed} unreadable lines in ${ref.filePath}: ${parsed.unparsedLines.join(", ")}`,
        );
      }

      return {
        ref,
        entries: parsed.entries,
        messageCount: parsed.messageCount,
        // Nothing to scan: Qwen Code records its own token counts per turn,
        // which beats anything reconstructed from the transcript.
        usageTexts: [],
        reportedUsage: parsed.usage,
        parseStats: parsed.parseStats,
      } satisfies SourceSession;
    });

  const resolveSessionRef = (projectStoragePath: string, sessionId: string) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const filePath = path.join(projectStoragePath, `${sessionId}.jsonl`);
      const stat = yield* fs.stat(filePath).pipe(Effect.catchAll(() => Effect.succeed(null)));
      if (stat === null) {
        return yield* new SourceSessionGoneError({ sourceId: QWEN_CODE_SOURCE_ID, sessionId });
      }

      return {
        sourceId: QWEN_CODE_SOURCE_ID,
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

      const exists = yield* fs.exists(root).pipe(Effect.catchAll(() => Effect.succeed(false)));
      if (!exists) {
        return {
          sourceId: QWEN_CODE_SOURCE_ID,
          rootPath: null,
          hasData: false,
          supported: false,
          unsupportedReason: "not-installed",
        } satisfies SourceDetection;
      }

      const projects = yield* listProjects();
      if (projects.length === 0) {
        return {
          sourceId: QWEN_CODE_SOURCE_ID,
          rootPath: root,
          hasData: false,
          supported: false,
          unsupportedReason: "no-data",
        } satisfies SourceDetection;
      }

      // Read a real session rather than trusting the layout, and require it to
      // have produced something. "Parsed without complaint" is not the test: a
      // schema that expects a field the format no longer has parses every
      // record happily and yields an empty conversation, which is precisely how
      // a whole history renders blank while looking like it worked.
      //
      // Bounded on purpose. This runs on every settings render, and reading
      // every transcript in every project on an install whose format has moved
      // is the one case where the cost would be unbounded.
      let sampled = 0;
      for (const project of projects) {
        if (sampled >= DETECT_SAMPLE) break;

        for (const name of yield* listChatFiles(project.storagePath)) {
          if (sampled >= DETECT_SAMPLE) break;
          sampled += 1;

          const lines = yield* readLines(path.join(project.storagePath, name));
          if (lines === null) continue;

          const parsed = parseChat(lines, {
            sessionKey: name.replace(/\.jsonl$/, ""),
            cwd: "",
          });

          if (parsed.entries.length > 0 && parsed.parseStats.unparsed === 0) {
            return {
              sourceId: QWEN_CODE_SOURCE_ID,
              rootPath: root,
              hasData: true,
              supported: true,
              unsupportedReason: null,
            } satisfies SourceDetection;
          }
        }
      }

      return {
        sourceId: QWEN_CODE_SOURCE_ID,
        rootPath: root,
        hasData: true,
        supported: false,
        unsupportedReason: "unknown-shape",
      } satisfies SourceDetection;
    });

  /**
   * Pure: a changed path under `projects/<encoded>/chats/<sessionID>.jsonl`
   * names both the project directory and the session, so nothing has to be read
   * to classify it.
   */
  const classifyChange = (absolutePath: string, roots: readonly string[]) => {
    const root = roots.find((candidate) => absolutePath.startsWith(`${candidate}/`));
    if (root === undefined) return null;

    const relative = absolutePath.slice(root.length + 1).split("/");
    if (relative.length !== 4) return null;

    const [projects, projectName, chats, fileName] = relative;
    if (projects !== PROJECTS_DIR || chats !== CHATS_DIR) return null;
    if (projectName === undefined || fileName === undefined || !fileName.endsWith(".jsonl")) {
      return null;
    }

    return {
      sourceId: QWEN_CODE_SOURCE_ID,
      projectStoragePath: `${root}/${PROJECTS_DIR}/${projectName}/${CHATS_DIR}`,
      sessionId: fileName.replace(/\.jsonl$/, ""),
      agentId: null,
    };
  };

  return {
    id: QWEN_CODE_SOURCE_ID,
    displayName: "Qwen Code",
    capabilities: {
      watch: true,
      interactive: false,
      deletable: false,
      // Tokens are recorded, prices are not — see the note on the adapter.
      cost: "unknown",
    },
    detect,
    listProjects,
    resolveProjectCwd,
    listSessions,
    readSession,
    resolveSessionRef,
    roots: () => rootPath.pipe(Effect.map((root) => [root])),
    classifyChange,
    headless: {
      executable: () => resolveOnPath(QWEN_CODE_SOURCE_ID, "qwen"),
      // `-p` is one non-interactive prompt; `--yolo` stops it blocking on an
      // approval prompt that has no terminal to answer it.
      args: (prompt) => ["--yolo", "-p", prompt],
      // Qwen Code prints the reply as prose and reports no cost on this path.
      parse: (stdout) => ({ text: stdout, costUsd: 0 }),
    },
  };
};

export const qwenCodeSourceAdapter = makeAdapter();

import { FileSystem, Path } from "@effect/platform";
import { Effect, Option } from "effect";
import { z } from "zod";
import { parseJsonl } from "../../../../claude-code/functions/parseJsonl.ts";

/**
 * Entry types that carry no `cwd`. Claude Code writes these as sidecars to the
 * conversation, so they are skipped when looking for the project's directory.
 */
const isMetaEntryType = (type: string): boolean =>
  type === "summary" ||
  type === "x-error" ||
  type === "file-history-snapshot" ||
  type === "queue-operation" ||
  type === "custom-title" ||
  type === "ai-title" ||
  type === "agent-name" ||
  type === "agent-setting" ||
  type === "pr-link" ||
  type === "last-prompt" ||
  type === "permission-mode";

/** The first `cwd` recorded in a transcript, or null if it holds only sidecars. */
export const extractCwdFromContent = (content: string): string | null => {
  for (const line of content.split("\n")) {
    const conversation = parseJsonl(line).at(0);
    if (conversation === undefined || isMetaEntryType(conversation.type)) {
      continue;
    }

    if ("cwd" in conversation) {
      return conversation.cwd;
    }
  }

  return null;
};

const sessionsIndexSchema = z.object({
  entries: z.array(z.looseObject({ projectPath: z.string() })),
});

/**
 * The project's real working directory, which Claude Code's dash-encoded
 * directory name cannot be reversed into (a dash is ambiguous). Recent CLI
 * versions write `sessions-index.json`; older ones only leave `cwd` in the
 * transcripts, so the oldest session is parsed as a fallback.
 */
export const extractProjectCwd = (
  projectDirPath: string,
  sessionFileNames: readonly string[],
): Effect.Effect<string | null, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const indexContent = yield* fs
      .readFileString(path.join(projectDirPath, "sessions-index.json"))
      .pipe(Effect.catchAll(() => Effect.succeed("")));

    if (indexContent !== "") {
      const parsed = yield* Effect.try({
        try: (): unknown => JSON.parse(indexContent),
        catch: () => null,
      }).pipe(Effect.catchAll(() => Effect.succeed(null)));

      const indexResult = sessionsIndexSchema.safeParse(parsed);
      const firstEntry = indexResult.success ? indexResult.data.entries.at(0) : undefined;
      if (firstEntry !== undefined) {
        return firstEntry.projectPath;
      }
    }

    const fileEntries: Array<{ fullPath: string; mtimeMs: number }> = [];
    for (const fileName of sessionFileNames) {
      const fullPath = path.join(projectDirPath, fileName);
      const stat = yield* fs.stat(fullPath).pipe(Effect.catchAll(() => Effect.succeed(null)));
      if (stat !== null) {
        fileEntries.push({
          fullPath,
          mtimeMs: Option.getOrElse(stat.mtime, () => new Date(0)).getTime(),
        });
      }
    }

    fileEntries.sort((a, b) => a.mtimeMs - b.mtimeMs);

    for (const entry of fileEntries) {
      const content = yield* fs
        .readFileString(entry.fullPath)
        .pipe(Effect.catchAll(() => Effect.succeed("")));
      if (content === "") continue;

      const cwd = extractCwdFromContent(content);
      if (cwd !== null) {
        return cwd;
      }
    }

    return null;
  });

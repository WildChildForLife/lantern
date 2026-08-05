import { Effect } from "effect";
import { z } from "zod";
import type { ForeignDatabase, ForeignDatabaseError } from "../../../functions/readOnlySqlite.ts";
import type { MessageFile } from "./parseMessages.ts";

/**
 * opencode's SQLite storage, as of 1.18.13.
 *
 * The same data as the JSON tree, in tables: `project` is the workspace,
 * `session` the conversation, and `message`/`part` hold the very JSON the file
 * layout wrote — one document per row in a `data` column. That is why this
 * reads rows and hands them to the existing parser rather than introducing a
 * second dialect: only the storage moved.
 *
 * Established by reading the database a real opencode 1.18.13 wrote in
 * `docker/`, not from a description of the schema.
 *
 * Deliberately narrow. The same file holds `account`, `control_account` and
 * `credential` tables carrying access and refresh tokens; nothing here selects
 * from them, and nothing should. Lantern needs conversations, not the user's
 * provider credentials.
 */

/** Every table these queries touch, so a moved schema is caught before a read. */
export const REQUIRED_TABLES = ["project", "session", "message", "part"] as const;

const projectRowSchema = z.looseObject({
  id: z.string(),
  worktree: z.string().nullable().optional(),
});

const sessionRowSchema = z.looseObject({
  id: z.string(),
  project_id: z.string().nullable().optional(),
  directory: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  time_updated: z.number().nullable().optional(),
  time_created: z.number().nullable().optional(),
  cost: z.number().nullable().optional(),
  tokens_input: z.number().nullable().optional(),
  tokens_output: z.number().nullable().optional(),
  tokens_cache_read: z.number().nullable().optional(),
  tokens_cache_write: z.number().nullable().optional(),
  model: z.string().nullable().optional(),
});

const dataRowSchema = z.looseObject({ id: z.string(), data: z.string() });
const partRowSchema = z.looseObject({ message_id: z.string(), data: z.string() });

export type OpencodeProjectRow = { readonly id: string; readonly worktree: string | null };

export type OpencodeSessionRow = {
  readonly id: string;
  readonly projectId: string | null;
  readonly directory: string | null;
  readonly title: string | null;
  readonly updatedMs: number;
  readonly costUsd: number | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly modelName: string | null;
};

export const readProjects = (
  database: ForeignDatabase,
): Effect.Effect<readonly OpencodeProjectRow[], ForeignDatabaseError> =>
  database.all("select id, worktree from project").pipe(
    Effect.map((rows) =>
      rows.flatMap((row) => {
        const parsed = projectRowSchema.safeParse(row);
        return parsed.success
          ? [{ id: parsed.data.id, worktree: parsed.data.worktree ?? null }]
          : [];
      }),
    ),
  );

/**
 * Every session, newest first.
 *
 * An archived session is still a conversation that happened, so it is listed
 * like any other — hiding it would lose history the user can still open in
 * opencode itself.
 */
export const readSessions = (
  database: ForeignDatabase,
): Effect.Effect<readonly OpencodeSessionRow[], ForeignDatabaseError> =>
  database
    .all(
      `select id, project_id, directory, title, time_created, time_updated,
              cost, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, model
       from session
       order by time_updated desc`,
    )
    .pipe(
      Effect.map((rows) =>
        rows.flatMap((row) => {
          const parsed = sessionRowSchema.safeParse(row);
          if (!parsed.success) return [];

          const data = parsed.data;
          return [
            {
              id: data.id,
              projectId: data.project_id ?? null,
              directory: data.directory ?? null,
              title: data.title ?? null,
              updatedMs: data.time_updated ?? data.time_created ?? 0,
              // A session that cost nothing recorded is still a session that
              // recorded a cost; only a missing column is unknown.
              costUsd: data.cost ?? null,
              inputTokens: data.tokens_input ?? 0,
              outputTokens: data.tokens_output ?? 0,
              cacheReadTokens: data.tokens_cache_read ?? 0,
              cacheWriteTokens: data.tokens_cache_write ?? 0,
              modelName: data.model ?? null,
            } satisfies OpencodeSessionRow,
          ];
        }),
      ),
    );

/**
 * One session's messages, each with its parts, in the shape the file reader
 * already produces — so both layouts meet at the same parser.
 *
 * A row whose `data` is not JSON is passed through as `null` rather than
 * skipped: dropping it here would lose a message and count nothing, which is
 * the shape of a format change that looks like it worked.
 */
export const readMessages = (
  database: ForeignDatabase,
  sessionId: string,
): Effect.Effect<readonly MessageFile[], ForeignDatabaseError> =>
  Effect.gen(function* () {
    const messageRows = yield* database.all(
      "select id, data from message where session_id = ? order by time_created, id",
      sessionId,
    );
    const partRows = yield* database.all(
      "select message_id, data from part where session_id = ? order by time_created, id",
      sessionId,
    );

    const partsByMessage = new Map<string, unknown[]>();
    for (const row of partRows) {
      const parsed = partRowSchema.safeParse(row);
      if (!parsed.success) continue;

      const existing = partsByMessage.get(parsed.data.message_id) ?? [];
      existing.push(parseJson(parsed.data.data));
      partsByMessage.set(parsed.data.message_id, existing);
    }

    return messageRows.flatMap((row) => {
      const parsed = dataRowSchema.safeParse(row);
      if (!parsed.success) return [];

      const parts = partsByMessage.get(parsed.data.id);
      return [
        {
          // The parser reports this when a message will not read; the row's id
          // is what identifies it here, as a filename does in the file layout.
          fileName: parsed.data.id,
          json: parseJson(parsed.data.data),
          parts: parts === undefined || parts.length === 0 ? undefined : parts,
        } satisfies MessageFile,
      ];
    });
  });

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

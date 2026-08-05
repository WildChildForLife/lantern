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

/**
 * Every table these queries touch, checked by `detect` before anything is read.
 *
 * The `project` table is not among them: the database records no directory per
 * project, so a workspace is derived from `session.directory` and the table is
 * never selected from.
 */
export const REQUIRED_TABLES = ["session", "message", "part"] as const;

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

/**
 * Only the identity is required of a `message`/`part` row.
 *
 * The `data` column is read separately and never has to parse — see
 * `parseDocument`.
 */
const messageRowSchema = z.looseObject({ id: z.string() });
const partRowSchema = z.looseObject({ message_id: z.string() });

/**
 * What `session.model` holds: a document, not a name.
 *
 * The column reads `{"id":"qwen3:0.6b","providerID":"…","variant":"…"}`, so
 * handing it on unread puts a JSON blob everywhere Lantern shows a model.
 */
const modelColumnSchema = z.looseObject({ id: z.string() });

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

const SESSION_COLUMNS = `id, project_id, directory, title, time_created, time_updated,
       cost, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, model`;

/**
 * Whether the database holds any session at all.
 *
 * Cheap on purpose: it decides which of opencode's two storage modes an install
 * is using, and that question is asked far more often than the history is read.
 */
export const hasSessions = (
  database: ForeignDatabase,
): Effect.Effect<boolean, ForeignDatabaseError> =>
  database.all("select id from session limit 1").pipe(Effect.map((rows) => rows.length > 0));

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
    .all(`select ${SESSION_COLUMNS} from session order by time_updated desc`)
    .pipe(Effect.map((rows) => rows.flatMap(toSessionRow)));

/**
 * One session by id.
 *
 * Separate from `readSessions` because reading a conversation should not cost a
 * scan of every other one: a sync reads sessions one at a time, and the table
 * holds every session the install has ever had.
 */
export const readSessionById = (
  database: ForeignDatabase,
  sessionId: string,
): Effect.Effect<OpencodeSessionRow | null, ForeignDatabaseError> =>
  database
    .all(`select ${SESSION_COLUMNS} from session where id = ?`, sessionId)
    .pipe(Effect.map((rows) => rows.flatMap(toSessionRow)[0] ?? null));

/**
 * A `session` row, or nothing when it cannot be identified.
 *
 * Dropping is right here and nowhere else in this file: a row whose `id` is not
 * a string cannot be filed, opened or linked to, so there is no session to lose
 * track of. A *message* that will not read is a different matter — see
 * `readMessages`.
 */
const toSessionRow = (row: Record<string, unknown>): OpencodeSessionRow[] => {
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
      // A session that cost nothing recorded is still a session that recorded a
      // cost; only a missing column is unknown.
      costUsd: data.cost ?? null,
      inputTokens: data.tokens_input ?? 0,
      outputTokens: data.tokens_output ?? 0,
      cacheReadTokens: data.tokens_cache_read ?? 0,
      cacheWriteTokens: data.tokens_cache_write ?? 0,
      modelName: modelNameFrom(data.model ?? null),
    } satisfies OpencodeSessionRow,
  ];
};

/** The model's own id out of the `model` document, or nothing recognisable. */
const modelNameFrom = (raw: string | null): string | null => {
  if (raw === null || raw === "") return null;

  const parsed = modelColumnSchema.safeParse(parseDocument(raw));
  // Not the document this release writes. Reporting the raw column would put
  // JSON where a model name goes, so the transcript's own answer is better.
  return parsed.success ? parsed.data.id : null;
};

/**
 * One session's messages, each with its parts, in the shape the file reader
 * already produces — so both layouts meet at the same parser.
 *
 * A row that will not read is passed through with `json: null` rather than
 * skipped — whether its `data` is not JSON or not even text. Dropping it here
 * would lose a message and count nothing, which is the shape of a format change
 * that looks like it worked; passed on, the parser counts it as `unparsed` and
 * `detect` refuses to claim support.
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
      // Only the message this part hangs off is load-bearing: a part that names
      // no message cannot be placed in any conversation. Its document, on the
      // other hand, is passed on however it reads — `null` included, which the
      // parser counts rather than ignores.
      if (!parsed.success) continue;

      const existing = partsByMessage.get(parsed.data.message_id) ?? [];
      existing.push(parseDocument(row["data"]));
      partsByMessage.set(parsed.data.message_id, existing);
    }

    return messageRows.flatMap((row) => {
      const parsed = messageRowSchema.safeParse(row);
      if (!parsed.success) return [];

      const parts = partsByMessage.get(parsed.data.id);
      return [
        {
          // The parser reports this when a message will not read; the row's id
          // is what identifies it here, as a filename does in the file layout.
          fileName: parsed.data.id,
          json: parseDocument(row["data"]),
          parts: parts === undefined || parts.length === 0 ? undefined : parts,
        } satisfies MessageFile,
      ];
    });
  });

/**
 * The JSON document in a `data` column, or `null` when it is not one.
 *
 * `null` for anything unreadable — invalid JSON, but also a value that is not
 * text at all, which is what a release that moved to a blob or a compressed
 * document would write. Both must reach the parser as an unreadable message
 * rather than as no message.
 */
const parseDocument = (raw: unknown): unknown => {
  if (typeof raw !== "string") return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

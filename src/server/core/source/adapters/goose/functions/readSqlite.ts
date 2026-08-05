import { Effect } from "effect";
import { z } from "zod";
import type { ForeignDatabase, ForeignDatabaseError } from "../../../functions/readOnlySqlite.ts";
import type { GooseMessage } from "./parseMessages.ts";

/**
 * goose's session store, as of 1.45.0: `sessions/sessions.db`.
 *
 * `sessions` carries the working directory, the title goose gave the
 * conversation and its own token totals; `messages` holds one row per message
 * with the parts in a `content_json` column.
 *
 * Established by reading the database a real goose 1.45.0 wrote in `docker/`,
 * not from a description of the schema.
 *
 * Deliberately narrow. `provider_inventory_entries` and `provider_inventory_models`
 * are the CLI's own model catalogue and are never selected from; goose keeps
 * provider credentials in the OS keyring rather than this file, and nothing
 * here would read them if it did.
 */

/** Every table these queries touch, so a moved schema is caught before a read. */
export const REQUIRED_TABLES = ["sessions", "messages"] as const;

const sessionRowSchema = z.looseObject({
  id: z.string(),
  name: z.string().nullable().optional(),
  working_dir: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  input_tokens: z.number().nullable().optional(),
  output_tokens: z.number().nullable().optional(),
  cache_read_tokens: z.number().nullable().optional(),
  cache_write_tokens: z.number().nullable().optional(),
  accumulated_cost: z.number().nullable().optional(),
  model_config_json: z.string().nullable().optional(),
});

const messageRowSchema = z.looseObject({
  id: z.number(),
  role: z.string(),
  content_json: z.string(),
  created_timestamp: z.number().nullable().optional(),
});

/** The model is inside a config document rather than a column of its own. */
const modelConfigSchema = z.looseObject({ model_name: z.string().optional() });

export type GooseSessionRow = {
  readonly id: string;
  readonly title: string | null;
  readonly workingDir: string | null;
  readonly updatedMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costUsd: number | null;
  readonly modelName: string | null;
};

/**
 * goose writes timestamps as SQL text rather than epoch milliseconds, so an
 * unparseable one becomes 0 instead of `NaN` — which would otherwise reach the
 * cache as a null mtime and re-sync the session on every pass.
 */
const toEpochMs = (value: string | null | undefined): number => {
  if (value === null || value === undefined || value === "") return 0;

  // SQLite's `datetime('now')` has no zone marker and is UTC by definition;
  // read as local time it would drift by the machine's offset.
  const normalised = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;

  const parsed = Date.parse(normalised);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const modelNameOf = (raw: string | null | undefined): string | null => {
  if (raw === null || raw === undefined || raw === "") return null;

  try {
    const parsed = modelConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data.model_name ?? null) : null;
  } catch {
    return null;
  }
};

export const readSessions = (
  database: ForeignDatabase,
): Effect.Effect<readonly GooseSessionRow[], ForeignDatabaseError> =>
  database
    .all(
      `select id, name, working_dir, created_at, updated_at,
              input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
              accumulated_cost, model_config_json
       from sessions
       order by updated_at desc`,
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
              title: data.name ?? null,
              workingDir: data.working_dir ?? null,
              updatedMs: toEpochMs(data.updated_at ?? data.created_at),
              inputTokens: data.input_tokens ?? 0,
              outputTokens: data.output_tokens ?? 0,
              cacheReadTokens: data.cache_read_tokens ?? 0,
              cacheWriteTokens: data.cache_write_tokens ?? 0,
              // goose leaves this null against a local provider, and a zero
              // there would read as "this session was free" rather than "no
              // price was recorded".
              costUsd: data.accumulated_cost ?? null,
              modelName: modelNameOf(data.model_config_json),
            } satisfies GooseSessionRow,
          ];
        }),
      ),
    );

/**
 * One session's messages, oldest first.
 *
 * A row that does not parse is passed through with its `content_json` intact
 * rather than skipped, so the parser counts it unreadable — dropping it here
 * would lose a message and count nothing, which is the shape of a format change
 * that looks like it worked.
 */
export const readMessages = (
  database: ForeignDatabase,
  sessionId: string,
): Effect.Effect<readonly GooseMessage[], ForeignDatabaseError> =>
  database
    .all(
      `select id, role, content_json, created_timestamp
       from messages
       where session_id = ?
       order by created_timestamp, id`,
      sessionId,
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row, index) => {
          const parsed = messageRowSchema.safeParse(row);
          if (!parsed.success) {
            return {
              id: `row-${index}`,
              role: "unknown",
              // Not JSON, so the parser counts it rather than dropping it.
              contentJson: "",
              createdMs: 0,
            } satisfies GooseMessage;
          }

          return {
            id: String(parsed.data.id),
            role: parsed.data.role,
            contentJson: parsed.data.content_json,
            // goose stores this one as epoch seconds, unlike the text columns.
            createdMs: (parsed.data.created_timestamp ?? 0) * 1000,
          } satisfies GooseMessage;
        }),
      ),
    );

import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// projects
// ---------------------------------------------------------------------------

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    path: text("path"),
    // Which agent CLI these sessions came from. Rows written before Lantern
    // read anything else are Claude Code's by definition.
    source: text("source").notNull().default("claude-code"),
    // The source's own identifier for the project — a directory name, a hash.
    sourceProjectKey: text("source_project_key"),
    // `path` normalised, so one repo recorded by two CLIs (or by one CLI before
    // and after a move) groups into a single workspace.
    canonicalPath: text("canonical_path"),
    sessionCount: integer("session_count").notNull().default(0),
    dirMtimeMs: integer("dir_mtime_ms").notNull(),
    syncedAt: integer("synced_at").notNull(),
  },
  (table) => [index("idx_projects_canonical_path").on(table.canonicalPath)],
);

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull().unique(),
    messageCount: integer("message_count").notNull().default(0),
    firstUserMessageJson: text("first_user_message_json"),
    customTitle: text("custom_title"),
    totalCostUsd: real("total_cost_usd").notNull().default(0),
    costBreakdownJson: text("cost_breakdown_json"),
    tokenUsageJson: text("token_usage_json"),
    modelName: text("model_name"),
    prLinksJson: text("pr_links_json"),
    fileMtimeMs: integer("file_mtime_ms").notNull(),
    lastModifiedAt: text("last_modified_at").notNull(),
    syncedAt: integer("synced_at").notNull(),
    permissionAllowlistJson: text("permission_allowlist_json"),
    // Deliberately not narrowed to `SourceId`: a row outlives the adapter that
    // wrote it, so a downgrade or a removed adapter must read back as data
    // rather than as a type error. `SessionLocatorService` is where an id
    // without an adapter is turned into a refusal.
    source: text("source").notNull().default("claude-code"),
    // The source's own identifier — a filename, a row id, a thread id.
    sourceSessionKey: text("source_session_key"),
    // Cost the source itself reported, where it reports one. Preferred over
    // anything derived from token counts.
    nativeCostUsd: real("native_cost_usd"),
    // Whether `total_cost_usd` was reported by the source, derived from a known
    // price table, or is not knowable. Unknown must never render as $0.00.
    // A closed set, unlike `source`: it is Lantern's own judgement about a row,
    // so it can never hold a value this build does not understand.
    costConfidence: text("cost_confidence", { enum: ["reported", "estimated", "unknown"] })
      .notNull()
      .default("estimated"),
  },
  (table) => [
    index("idx_sessions_project_id").on(table.projectId),
    index("idx_sessions_file_mtime").on(table.fileMtimeMs),
    index("idx_sessions_source").on(table.source),
  ],
);

// ---------------------------------------------------------------------------
// session_topics
//
// The category Claude put a conversation in. Kept out of `sessions` because it
// is derived by an extra classification pass, not by reading the JSONL.
// ---------------------------------------------------------------------------

export const sessionTopics = sqliteTable("session_topics", {
  sessionId: text("session_id").primaryKey(),
  label: text("label").notNull(),
  icon: text("icon").notNull(),
  // What was classified. When the conversation gets a better title, the stored
  // topic is stale and the session is queued again.
  sourceText: text("source_text").notNull(),
  classifiedAt: integer("classified_at").notNull(),
});

// ---------------------------------------------------------------------------
// sync_state
// ---------------------------------------------------------------------------

export const syncState = sqliteTable("sync_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// ---------------------------------------------------------------------------
// Inferred row types (for use outside drizzle query builder)
// ---------------------------------------------------------------------------

export type ProjectRow = typeof projects.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type SyncStateRow = typeof syncState.$inferSelect;

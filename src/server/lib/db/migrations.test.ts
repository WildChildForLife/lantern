/* Node built-ins are used directly here: driving the real migrator is the only way to reproduce an upgrade. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { describe, expect, it } from "vitest";
import * as schema from "./schema.ts";

const migrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url));

const migrateInMemory = (before?: (sqlite: DatabaseSync) => void) => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  before?.(sqlite);
  migrate(drizzle({ client: sqlite, schema }), { migrationsFolder });
  return sqlite;
};

/** The raw DDL older builds ran at startup, before the table was migrated. */
const LEGACY_SESSION_TOPICS_DDL = `
  CREATE TABLE IF NOT EXISTS session_topics (
    session_id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    icon TEXT NOT NULL,
    source_text TEXT NOT NULL,
    classified_at INTEGER NOT NULL
  )
`;

const columnNames = (sqlite: DatabaseSync, table: string): string[] =>
  sqlite
    .prepare(`SELECT name FROM pragma_table_info(?)`)
    .all(table)
    .map((row) => String(row.name));

describe("cache database migrations", () => {
  it("creates every table the app reads", () => {
    const sqlite = migrateInMemory();

    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String(row.name));

    expect(tables).toEqual(expect.arrayContaining(["projects", "sessions", "session_topics"]));
  });

  it("records the source of every project and session", () => {
    const sqlite = migrateInMemory();

    expect(columnNames(sqlite, "projects")).toEqual(
      expect.arrayContaining(["source", "source_project_key", "canonical_path"]),
    );
    expect(columnNames(sqlite, "sessions")).toEqual(
      expect.arrayContaining([
        "source",
        "source_session_key",
        "native_cost_usd",
        "cost_confidence",
      ]),
    );
  });

  it("defaults existing rows to Claude Code without a data pass", () => {
    const sqlite = migrateInMemory();

    sqlite.prepare("INSERT INTO projects (id, dir_mtime_ms, synced_at) VALUES ('p1', 0, 0)").run();

    const row = sqlite.prepare("SELECT source FROM projects WHERE id = 'p1'").get();

    expect(row?.source).toBe("claude-code");
  });

  /**
   * `session_topics` shipped as raw DDL and was never migrated, so an upgrading
   * install already has it. A plain CREATE TABLE would throw here — and a failed
   * migration makes DrizzleService delete the cache, taking every classified
   * topic with it.
   */
  it("upgrades an install whose session_topics table already exists", () => {
    const sqlite = migrateInMemory((db) => {
      db.exec(LEGACY_SESSION_TOPICS_DDL);
      db.exec(
        "INSERT INTO session_topics (session_id, label, icon, source_text, classified_at) VALUES ('s1', 'Infra', 'server', 'text', 1)",
      );
    });

    const row = sqlite.prepare("SELECT label FROM session_topics WHERE session_id = 's1'").get();

    expect(row?.label).toBe("Infra");
  });

  /**
   * What a restart after an upgrade actually does: a second process opens the
   * same file and runs the migrator again. An in-memory database cannot show
   * this, since it dies with its connection.
   */
  it("is safe to run again against a database on disk", () => {
    const directory = mkdtempSync(join(tmpdir(), "lantern-migrations-"));
    const databasePath = join(directory, "cache.db");

    try {
      const first = new DatabaseSync(databasePath);
      migrate(drizzle({ client: first, schema }), { migrationsFolder });
      first.prepare("INSERT INTO projects (id, dir_mtime_ms, synced_at) VALUES ('p1', 0, 0)").run();
      first.close();

      const second = new DatabaseSync(databasePath);
      expect(() =>
        migrate(drizzle({ client: second, schema }), { migrationsFolder }),
      ).not.toThrow();

      const row = second.prepare("SELECT source FROM projects WHERE id = 'p1'").get();
      expect(row?.source).toBe("claude-code");
      second.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

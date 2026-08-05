/* oxlint-disable no-restricted-imports */
/* Exception: this test-only layer intentionally uses Node built-ins because migrating all DB tests to the new runtime abstraction at once is high-cost. Keep this exception scoped to this file only. */
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { Layer } from "effect";
import { type DrizzleDb, DrizzleService } from "../../server/lib/db/DrizzleService";
import { SESSION_MESSAGES_FTS_DDL } from "../../server/lib/db/ftsDdl";
import * as schema from "../../server/lib/db/schema";

const migrationsFolder = fileURLToPath(new URL("../../server/lib/db/migrations", import.meta.url));

export const createInMemoryDrizzle = () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const db = drizzle({ client: sqlite, schema });
  migrate(db, { migrationsFolder });
  sqlite.exec(SESSION_MESSAGES_FTS_DDL);

  return { db, rawDb: sqlite };
};

export const makeDrizzleTestServiceLayer = (seed?: (db: DrizzleDb) => void) => {
  const { db, rawDb } = createInMemoryDrizzle();
  seed?.(db);
  return Layer.succeed(DrizzleService, { db, rawDb });
};

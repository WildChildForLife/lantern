import { FileSystem, Path } from "@effect/platform";
import { Effect } from "effect";
import { z } from "zod";
import { CliConfigBaseDir } from "../config/cliConfigStore.ts";

const CACHE_FILE = "update-check.json";

/**
 * What the last registry check found, and when.
 *
 * Kept out of `config.json` on purpose: that file answers what the user was
 * asked, and the settings the board writes are read-modify-written. A timestamp
 * updating itself in the background has no business racing that.
 */
const updateCacheSchema = z.object({
  checkedAt: z.number(),
  latest: z.string(),
});

export type UpdateCache = z.infer<typeof updateCacheSchema>;

export const parseUpdateCache = (raw: unknown): UpdateCache | null => {
  const result = updateCacheSchema.safeParse(raw);

  return result.success ? result.data : null;
};

const cachePath = Effect.gen(function* () {
  const path = yield* Path.Path;

  return path.join(yield* CliConfigBaseDir, CACHE_FILE);
});

/** Null for anything unreadable: a stale notice is not worth an error. */
export const readUpdateCache = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const file = yield* cachePath;

  const content = yield* fs.readFileString(file).pipe(Effect.catchAll(() => Effect.succeed("")));
  if (content === "") {
    return null;
  }

  const raw = yield* Effect.try({
    try: (): unknown => JSON.parse(content),
    catch: () => null,
  }).pipe(Effect.catchAll(() => Effect.succeed(null)));

  return parseUpdateCache(raw);
});

export const writeUpdateCache = (cache: UpdateCache) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = yield* cachePath;

    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* fs.writeFileString(file, `${JSON.stringify(cache, null, 2)}\n`);
  });

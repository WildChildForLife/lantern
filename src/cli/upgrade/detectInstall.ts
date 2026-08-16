import { FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { classifyInstallSource, type InstallProbe, type InstallSource } from "./installSource.ts";

const run = <A>(effect: Effect.Effect<A, never, FileSystem.FileSystem | Path.Path>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeContext.layer)));

const exists = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    return yield* fs.exists(path).pipe(Effect.catchAll(() => Effect.succeed(false)));
  });

/**
 * The directory of the `package.json` this build belongs to.
 *
 * Walked rather than assumed: the bundle sits in `dist/` when installed and in
 * `src/server/` when a checkout runs it from source, and both have to resolve
 * to the same root for the checkout test to hold.
 */
const findPackageRoot = (start: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    let directory = path.dirname(start);

    for (let depth = 0; depth < 10; depth += 1) {
      if (yield* exists(path.join(directory, "package.json"))) {
        return directory;
      }

      const parent = path.dirname(directory);
      if (parent === directory) {
        break;
      }
      directory = parent;
    }

    return path.dirname(start);
  });

/**
 * Everything the classifier needs, gathered from this machine.
 *
 * The entry *module* is resolved rather than `process.argv[1]`: argv[1] is the
 * shim a package manager wrote onto PATH, and following it back to the real
 * file is what tells a Cellar from a global `node_modules`.
 */
export const detectInstallSource = (): Promise<InstallSource> =>
  run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const scriptPath = yield* fs
        .realPath(import.meta.filename)
        .pipe(Effect.catchAll(() => Effect.succeed(import.meta.filename)));
      const packageRoot = yield* findPackageRoot(scriptPath);

      const [dockerMarker, podmanMarker, gitMarker, dpkg, rpm] = yield* Effect.all([
        exists("/.dockerenv"),
        exists("/run/.containerenv"),
        exists(path.join(packageRoot, ".git")),
        exists("/usr/bin/dpkg"),
        exists("/usr/bin/rpm"),
      ]);

      const probe: InstallProbe = {
        scriptPath,
        packageRoot,
        platform: process.platform,
        // Read at the boundary, the way the first-run wizard reads it: the
        // classifier itself stays a function of its arguments.
        // oxlint-disable-next-line no-process-env
        env: process.env,
        containerMarker: dockerMarker || podmanMarker,
        gitMarker,
        systemPackageManager: dpkg ? "apt" : rpm ? "dnf" : "unknown",
      };

      return classifyInstallSource(probe);
    }),
  );

/**
 * Whether this user could replace the tree an upgrade would rewrite.
 *
 * Asked before running anything so a root-owned prefix ends in a printed
 * `sudo …` line rather than a half-finished install — Lantern never elevates
 * itself.
 */
export const isWritable = (directory: string): Promise<boolean> =>
  run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      return yield* fs.access(directory, { writable: true }).pipe(
        Effect.as(true),
        Effect.catchAll(() => Effect.succeed(false)),
      );
    }),
  );

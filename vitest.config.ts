import { fileURLToPath, URL } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const config = defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    // Vitest does not read .gitignore, so ignoring the harness's worktrees
    // there is not enough on its own to keep a second copy of the tree out of
    // the run.
    exclude: [...configDefaults.exclude, ".claude/**"],
    // Well above what any test needs on an idle machine, because the machine is
    // not idle when it matters: the pre-push hook runs lint, typecheck, the
    // i18n check and this in parallel, and the suite's slowest tests — the
    // fixture ingest, the wizard's Ink renders — went from ~350ms to over 12s
    // under that load and failed the default 5s. A timeout is there to catch a
    // test that has hung, not one that is waiting its turn for a core.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ["src/testing/setup/vitest.setup.ts"],
    env: {
      ENVIRONMENT: "local",
    },
  },
});

export default config;

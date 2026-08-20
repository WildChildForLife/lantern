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
    setupFiles: ["src/testing/setup/vitest.setup.ts"],
    env: {
      ENVIRONMENT: "local",
    },
  },
});

export default config;

import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    main: "src/server/main.ts",
  },
  outDir: "dist",
  platform: "node",
  target: "node24",
  format: "esm",
  dts: false,
  clean: true,
  sourcemap: false,
  fixedExtension: false,
  copy: [{ from: "src/server/lib/db/migrations", to: "dist" }],
  deps: {
    onlyBundle: false,
  },
});

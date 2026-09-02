import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The conventions plugin, exercised through oxlint rather than by calling its
 * rules directly.
 *
 * These four rules are the only thing standing between the codebase and a
 * barrel file, a `__tests__` directory, the web importing the server, or `@/`
 * outside `src/web`. The plugin itself is linted by nothing and typechecked by
 * nothing — `scripts/**` is ignored by oxlint and tsconfig only includes `src`
 * — so a regex that quietly stops matching would disable a rule with nothing to
 * show for it.
 *
 * Driving the real binary against real files is what catches that. It covers
 * the wiring as well as the logic: the plugin path in `.oxlintrc.json`, the
 * rules being switched on, and the reports coming back under the names the
 * config uses. Calling `create()` with a hand-made context would test none of
 * those, and all of them have been wrong at some point.
 */

const execFileAsync = promisify(execFile);

const root = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Fixtures live outside the repository, and oxlint runs from inside it.
 *
 * They are deliberate violations, so writing them into the tree would mean
 * `pnpm lint` failing for as long as they existed, and git-ignoring them to
 * avoid that would hide them from oxlint too — it reads `.gitignore` by
 * default, and `--no-ignore` does not override that. A temp directory has
 * neither problem and leaves nothing behind. The working directory stays at the
 * repo root so the config resolves, and with it the plugin path inside it.
 */
let fixtureRoot = "";

/**
 * Paths carry the meaning here — three of the four rules decide what to do from
 * the filename alone — so the fixtures need a tree shaped like the real one.
 */
const FIXTURES = {
  "src/server/barrel/index.ts": 'export { a } from "./a";\nexport * from "./b";\n',
  "src/server/notBarrel/index.ts": 'export { a } from "./a";\nexport const b = 1;\n',
  "src/web/__tests__/moved.test.ts": "export const a = 1;\n",
  "src/web/colocated.test.ts": "export const a = 1;\n",
  "src/web/importsServer.ts": 'import { a } from "@/server/a";\n\nexport const b = a;\n',
  "src/web/importsServerType.ts":
    'import type { A } from "@/server/a";\n\nexport const b: A | null = null;\n',
  "src/server/importsWeb.ts": 'import { a } from "@/web/a";\n\nexport const b = a;\n',
  "src/server/usesAlias.ts": 'import { a } from "@/lib/a";\n\nexport const b = a;\n',
  "src/web/usesAlias.ts": 'import { a } from "@/lib/a";\n\nexport const b = a;\n',
};

/** file path (as reported) -> the conventions rules that fired on it */
const reported = new Map();

const rulesFor = (fixture) => reported.get(fixture) ?? [];

beforeAll(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "lantern-conventions-"));

  for (const [relativePath, source] of Object.entries(FIXTURES)) {
    const absolutePath = path.join(fixtureRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, source);
  }

  const oxlint = path.join(root, "node_modules", ".bin", "oxlint");
  const output = await execFileAsync(oxlint, ["--config", ".oxlintrc.json", fixtureRoot], {
    cwd: root,
  })
    // A run that finds violations exits non-zero, which is the expected case
    // here; the report is on stdout either way.
    .then((result) => result.stdout)
    .catch((error) => String(error.stdout ?? ""));

  for (const line of output.split("\n")) {
    const match = /^(\S+?):\d+:\d+: \w+ conventions\(([\w-]+)\)/u.exec(line);
    if (match === null) {
      continue;
    }

    const [, filePath = "", rule = ""] = match;
    const fixture = path.relative(fixtureRoot, path.resolve(root, filePath)).replaceAll("\\", "/");
    reported.set(fixture, [...(reported.get(fixture) ?? []), rule]);
  }
}, 60_000);

afterAll(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe("conventions plugin", () => {
  /**
   * If this fails, every assertion below would pass by reporting nothing, so it
   * is checked on its own: the plugin has to have loaded at all.
   */
  it("is loaded by oxlint and reports under the conventions name", () => {
    expect(reported.size).toBeGreaterThan(0);
  });
});

describe("no-barrel-file", () => {
  it("rejects an index that only re-exports", () => {
    expect(rulesFor("src/server/barrel/index.ts")).toContain("no-barrel-file");
  });

  /** An index that carries its own code is a module, not a barrel. */
  it("allows an index that also defines something", () => {
    expect(rulesFor("src/server/notBarrel/index.ts")).not.toContain("no-barrel-file");
  });
});

describe("colocated-tests", () => {
  it("rejects a test in a __tests__ directory", () => {
    expect(rulesFor("src/web/__tests__/moved.test.ts")).toContain("colocated-tests");
  });

  it("allows a test sitting next to its source", () => {
    expect(rulesFor("src/web/colocated.test.ts")).not.toContain("colocated-tests");
  });
});

describe("module-boundaries", () => {
  it("stops the web importing the server", () => {
    expect(rulesFor("src/web/importsServer.ts")).toContain("module-boundaries");
  });

  /** Hono RPC shares its types across the boundary; only its values may not. */
  it("allows the web to import server types", () => {
    expect(rulesFor("src/web/importsServerType.ts")).not.toContain("module-boundaries");
  });

  /** The exemption goes one way. A server importing web code has no such need. */
  it("stops the server importing the web", () => {
    expect(rulesFor("src/server/importsWeb.ts")).toContain("module-boundaries");
  });
});

describe("no-project-alias-outside-web", () => {
  it("rejects an @/ import from the server", () => {
    expect(rulesFor("src/server/usesAlias.ts")).toContain("no-project-alias-outside-web");
  });

  it("allows an @/ import from the web", () => {
    expect(rulesFor("src/web/usesAlias.ts")).not.toContain("no-project-alias-outside-web");
  });
});

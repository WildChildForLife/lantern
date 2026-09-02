import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
 * — so a regex that quietly stopped matching would disable a rule with nothing
 * to show for it.
 *
 * Two halves, because they fail for different reasons and a single check would
 * confuse them: the rules are run against fixtures under a config written here,
 * and the repository's own config is read to confirm it still points at the
 * plugin and still switches every rule on.
 */

const execFileAsync = promisify(execFile);

const root = fileURLToPath(new URL("../..", import.meta.url));
const pluginPath = path.join(root, "scripts", "lints", "conventions.js");
const projectConfigPath = path.join(root, ".oxlintrc.json");

const RULES = [
  "no-barrel-file",
  "colocated-tests",
  "module-boundaries",
  "no-project-alias-outside-web",
];

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

/**
 * Everything lives outside the repository, and oxlint runs from inside it.
 *
 * The fixtures are deliberate violations, so writing them into the tree would
 * mean `pnpm lint` failing for as long as they existed — and git-ignoring them
 * to avoid that would hide them from oxlint too, which reads `.gitignore` by
 * default and does not stop at `--no-ignore`.
 *
 * The config is written here rather than reusing the project's so that this
 * loads the plugin and nothing else. The real one turns on type-aware linting,
 * which wants a tsconfig covering the files being linted; pointing it at a tree
 * outside the project made the whole run produce nothing, and every assertion
 * below read that silence as a pass.
 */
let fixtureRoot = "";

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

  const configPath = path.join(fixtureRoot, "oxlintrc.json");
  await writeFile(
    configPath,
    JSON.stringify({
      plugins: [],
      jsPlugins: [pluginPath],
      categories: {},
      rules: Object.fromEntries(RULES.map((rule) => [`conventions/${rule}`, "error"])),
    }),
  );

  const oxlint = path.join(root, "node_modules", ".bin", "oxlint");
  // `--format json`, not the default, because oxlint recognises CI and switches
  // to GitHub's annotation format on its own. Reading the human format meant
  // this passed here and matched nothing on a runner.
  //
  // A run that finds violations exits non-zero, which is the expected case
  // here, so the rejection carries the report rather than a problem.
  const { stdout, stderr } = await execFileAsync(
    oxlint,
    ["--config", configPath, "--format", "json", "--no-ignore", fixtureRoot],
    { cwd: root },
  ).catch((error) => ({ stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? "") }));

  const diagnostics = (() => {
    try {
      return JSON.parse(stdout).diagnostics ?? [];
    } catch {
      return [];
    }
  })();

  for (const diagnostic of diagnostics) {
    const rule = /^conventions\(([\w-]+)\)$/u.exec(diagnostic.code ?? "")?.[1];
    if (rule === undefined) {
      continue;
    }

    const fixture = path
      .relative(fixtureRoot, path.resolve(root, diagnostic.filename ?? ""))
      .replaceAll("\\", "/");
    reported.set(fixture, [...(reported.get(fixture) ?? []), rule]);
  }

  // Loudly, rather than leaving every assertion below to pass on an empty map.
  // The first version of this swallowed whatever oxlint said and the failure
  // read as "the rules do not work" in CI, which was not the problem.
  if (reported.size === 0) {
    throw new Error(
      `oxlint reported no conventions violations, so something upstream of the rules failed.\n` +
        `stdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
}, 60_000);

afterAll(async () => {
  if (fixtureRoot !== "") {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
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

/**
 * The rules above are run under a config written for them, so none of it proves
 * the repository is actually using the plugin. That is what this checks, and it
 * is the half that breaks when a path is renamed or a rule is dropped.
 */
describe("the project's own oxlint config", () => {
  /**
   * JSONC: the file is heavily commented.
   *
   * Character by character rather than by regex, because the comment markers
   * also appear inside string values — `typescript/no-unsafe-type-assertion`
   * and friends — and a regex that cannot see it is inside a string cuts the
   * string in half.
   */
  const stripJsonComments = (source) => {
    let output = "";
    let inString = false;
    let escaped = false;

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];

      if (inString) {
        output += char;
        inString = escaped ? inString : char !== '"';
        escaped = !escaped && char === "\\";
        continue;
      }

      if (char === '"') {
        inString = true;
        output += char;
        continue;
      }

      if (char === "/" && source[index + 1] === "/") {
        const end = source.indexOf("\n", index);
        index = end === -1 ? source.length : end - 1;
        continue;
      }

      if (char === "/" && source[index + 1] === "*") {
        const end = source.indexOf("*/", index + 2);
        index = end === -1 ? source.length : end + 1;
        continue;
      }

      output += char;
    }

    return output;
  };

  const readProjectConfig = async () =>
    JSON.parse(stripJsonComments(await readFile(projectConfigPath, "utf8")));

  it("loads the plugin from a path that exists", async () => {
    const config = await readProjectConfig();
    const declared = config.jsPlugins ?? [];

    expect(declared).toHaveLength(1);

    const [declaredPath = ""] = declared;
    await expect(access(path.resolve(root, declaredPath))).resolves.toBeUndefined();
  });

  it("switches every rule the plugin defines on", async () => {
    const config = await readProjectConfig();

    for (const rule of RULES) {
      expect(config.rules?.[`conventions/${rule}`]).toBe("error");
    }
  });

  /** A rule added to the plugin but never enabled would do nothing. */
  it("enables every rule the plugin exports, and no more", async () => {
    const { default: plugin } = await import(pluginPath);

    expect(Object.keys(plugin.rules).sort()).toStrictEqual([...RULES].sort());
  });
});

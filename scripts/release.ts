import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import inquirer from "inquirer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const run = (command: string, args: string[] = []): string =>
  execFileSync(command, args, { cwd: root, encoding: "utf-8" }).trim();

const runOrFail = (command: string, args: string[], label: string): void => {
  try {
    execFileSync(command, args, { cwd: root, stdio: "inherit" });
  } catch {
    console.error(`\n✗ ${label} failed. Aborting release.`);
    process.exit(1);
  }
};

const readGitConfig = (key: string): string => {
  try {
    return run("git", ["config", "--get", key]).toLowerCase();
  } catch {
    return "";
  }
};

type CliOptions = {
  readonly yes: boolean;
  readonly version: string | undefined;
};

const parseCliArgs = (args: readonly string[]): CliOptions => {
  let yes = false;
  let version: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === undefined) {
      continue;
    }

    if (arg === "-y" || arg === "--yes") {
      yes = true;
      continue;
    }

    if (arg === "--version") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        console.error("✗ --version requires a value.");
        process.exit(1);
      }
      version = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--version=")) {
      version = arg.slice("--version=".length);
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      console.log(
        "Usage: pnpm release [-y|--yes] [--version patch|minor|major|beta|x.y.z[-tag.n]]",
      );
      process.exit(0);
    }

    console.error(`✗ Unknown argument: ${arg}`);
    process.exit(1);
  }

  return { yes, version };
};

const cliOptions = parseCliArgs(process.argv.slice(2));

const pkgPath = path.join(root, "package.json");
const parsedPackageJson: unknown = JSON.parse(readFileSync(pkgPath, "utf-8"));

if (
  typeof parsedPackageJson !== "object" ||
  parsedPackageJson === null ||
  Array.isArray(parsedPackageJson) ||
  !("version" in parsedPackageJson) ||
  typeof parsedPackageJson.version !== "string"
) {
  console.error("✗ version field not found in package.json");
  process.exit(1);
}

const pkg = parsedPackageJson;
const current = parsedPackageJson.version;

console.log(`Current version: ${current}\n`);

const status = run("git", ["status", "--porcelain"]);
if (status !== "") {
  console.error("✗ Working tree is not clean. Commit or stash changes first.");
  process.exit(1);
}

const gpgFormat = readGitConfig("gpg.format");
const commitSign = readGitConfig("commit.gpgsign");
const tagSign = readGitConfig("tag.gpgsign");

if (gpgFormat !== "ssh" || commitSign !== "true" || tagSign !== "true") {
  console.error("✗ Git signing is not configured. Required:");
  console.error("  git config --global gpg.format ssh");
  console.error("  git config --global commit.gpgsign true");
  console.error("  git config --global tag.gpgsign true");
  process.exit(1);
}

const parseVersion = (
  v: string,
): { major: number; minor: number; patch: number; pre: string | undefined } => {
  const [base, pre] = v.split("-");
  const segments = (base ?? "").split(".").map(Number);
  return {
    major: segments[0] ?? 0,
    minor: segments[1] ?? 0,
    patch: segments[2] ?? 0,
    pre,
  };
};

const bumpChoices = (v: string): { name: string; value: string }[] => {
  const { major, minor, patch, pre } = parseVersion(v);

  if (pre !== undefined) {
    const preParts = pre.split(".");
    const preTag = preParts[0] ?? "beta";
    const preNum = Number(preParts[1] ?? 0);
    const nextPre = `${major}.${minor}.${patch}-${preTag}.${preNum + 1}`;
    return [
      { name: `${preTag} (${nextPre})`, value: nextPre },
      {
        name: `patch (${major}.${minor}.${patch})`,
        value: `${major}.${minor}.${patch}`,
      },
      {
        name: `minor (${major}.${minor + 1}.0)`,
        value: `${major}.${minor + 1}.0`,
      },
      { name: `major (${major + 1}.0.0)`, value: `${major + 1}.0.0` },
    ];
  }

  const nextPatch = `${major}.${minor}.${patch + 1}`;
  return [
    { name: `patch (${nextPatch})`, value: nextPatch },
    {
      name: `minor (${major}.${minor + 1}.0)`,
      value: `${major}.${minor + 1}.0`,
    },
    { name: `major (${major + 1}.0.0)`, value: `${major + 1}.0.0` },
    { name: `beta (${nextPatch}-beta.0)`, value: `${nextPatch}-beta.0` },
  ];
};

type VersionResolveResult =
  | { readonly type: "ok"; readonly version: string }
  | { readonly type: "error"; readonly message: string };

const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const resolveVersion = (versionSpec: string, fromVersion: string): VersionResolveResult => {
  const { major, minor, patch, pre } = parseVersion(fromVersion);
  const nextPatch = `${major}.${minor}.${patch + 1}`;

  if (versionSpec === "patch") {
    return {
      type: "ok",
      version: pre === undefined ? nextPatch : `${major}.${minor}.${patch}`,
    };
  }

  if (versionSpec === "minor") {
    return { type: "ok", version: `${major}.${minor + 1}.0` };
  }

  if (versionSpec === "major") {
    return { type: "ok", version: `${major + 1}.0.0` };
  }

  if (versionSpec === "beta") {
    if (pre === undefined) {
      return { type: "ok", version: `${nextPatch}-beta.0` };
    }

    const preParts = pre.split(".");
    const preTag = preParts[0] ?? "beta";
    const preNum = Number(preParts[1] ?? 0);
    return { type: "ok", version: `${major}.${minor}.${patch}-${preTag}.${preNum + 1}` };
  }

  if (semverPattern.test(versionSpec)) {
    return { type: "ok", version: versionSpec };
  }

  return {
    type: "error",
    message:
      "Unsupported --version value. Use patch, minor, major, beta, or an explicit semver like 1.2.3-beta.0.",
  };
};

const promptVersion = async (): Promise<string> => {
  const { version } = await inquirer.prompt<{ version: string }>([
    {
      type: "rawlist",
      name: "version",
      message: "Select release version:",
      choices: [...bumpChoices(current), { name: "Custom", value: "custom" }],
    },
  ]);

  if (version !== "custom") {
    return version;
  }

  const { custom } = await inquirer.prompt<{ custom: string }>([
    { type: "input", name: "custom", message: "Enter version:" },
  ]);
  return custom;
};

const nextVersion =
  cliOptions.version === undefined
    ? await promptVersion()
    : (() => {
        const result = resolveVersion(cliOptions.version, current);
        if (result.type === "error") {
          console.error(`✗ ${result.message}`);
          process.exit(1);
        }
        return result.version;
      })();

const tag = `v${nextVersion}`;

const confirmed = cliOptions.yes
  ? true
  : (
      await inquirer.prompt<{ confirmed: boolean }>([
        {
          type: "confirm",
          name: "confirmed",
          message: `Release ${tag}? This will commit, tag (signed), and push.`,
          default: false,
        },
      ])
    ).confirmed;

if (!confirmed) {
  console.log("Aborted.");
  process.exit(0);
}

console.log("\nRunning checks...\n");
runOrFail("pnpm", ["gatecheck", "check"], "Gatecheck");
runOrFail("./scripts/lingui-check.sh", [], "Lingui check");
runOrFail("pnpm", ["audit"], "Audit");
runOrFail("pnpm", ["test"], "Test");
runOrFail("pnpm", ["build"], "Build");
console.log("\n✓ All checks passed.\n");

const nextPkg = { ...pkg, version: nextVersion };
writeFileSync(pkgPath, `${JSON.stringify(nextPkg, null, 2)}\n`);
console.log(`\nUpdated package.json to ${nextVersion}`);

run("git", ["add", "package.json"]);
runOrFail("git", ["commit", "-S", "-m", `chore: release ${tag}`], "Signed commit");
runOrFail("git", ["tag", "-s", tag, "-m", tag], "Signed tag");

console.log(`\nCreated signed commit and tag ${tag}`);

runOrFail("git", ["push"], "Push commits");
runOrFail("git", ["push", "--tags"], "Push tags");

console.log(`\n✓ Released ${tag} - GitHub Actions will publish to npm.`);

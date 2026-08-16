import packageJson from "../../../package.json" with { type: "json" };

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/** Where this copy of Lantern came from, and what could replace it. */
export type InstallSource =
  | {
      kind: "npm-global";
      manager: PackageManager;
      /** The global `node_modules` holding Lantern — what the upgrade rewrites. */
      root: string;
    }
  | { kind: "npx-cache" }
  | { kind: "homebrew"; prefix: string }
  | { kind: "system-package"; manager: "apt" | "dnf" | "unknown" }
  | { kind: "docker" }
  | { kind: "git-checkout"; root: string }
  | { kind: "unknown"; path: string };

export type InstallProbe = {
  /** The running entry module, with every symlink resolved. */
  scriptPath: string;
  /** Directory of the nearest `package.json` above it. */
  packageRoot: string;
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  /** Whether `/.dockerenv` or `/run/.containerenv` is there. */
  containerMarker: boolean;
  /** Whether a `.git` entry sits beside `packageRoot`. */
  gitMarker: boolean;
  /** Which tool owns system packages here, so a refusal can name the remover. */
  systemPackageManager: "apt" | "dnf" | "unknown";
};

const PACKAGE_SEGMENT = `/node_modules/${packageJson.name}/`;
const CELLAR_SEGMENT = "/Cellar/";
const SYSTEM_PACKAGE_PREFIX = "/usr/lib/lantern/";
const CONTAINER_IMAGE_PREFIX = "/app/";

/** Windows writes the same trees with the other separator; nothing below cares which. */
const normalise = (path: string): string => path.replaceAll("\\", "/");

const NPX_CACHE_SEGMENTS = [
  // npm: ~/.npm/_npx/<hash>/node_modules/…
  "/_npx/",
  // pnpm: ~/.local/share/pnpm/dlx-<hash>/node_modules/…
  "/dlx-",
  // bun: ~/.bun/install/cache/<package>@<version>/…
  "/.bun/install/cache/",
];

const GLOBAL_ROOTS: ReadonlyArray<{ manager: PackageManager; segments: readonly string[] }> = [
  { manager: "pnpm", segments: ["/pnpm/global/"] },
  { manager: "yarn", segments: ["/yarn/global/", "/.yarn/global/"] },
  { manager: "bun", segments: ["/.bun/install/global/"] },
];

/**
 * Which package manager put this tree here, from the shape of the path.
 *
 * Not `npm_config_user_agent`: that is only set when a package manager spawned
 * the process, and nobody upgrades Lantern by asking npm to run it. The global
 * root each manager writes to is the one signal that survives being launched
 * from a shell.
 */
const globalManager = (path: string): PackageManager => {
  for (const { manager, segments } of GLOBAL_ROOTS) {
    if (segments.some((segment) => path.includes(segment))) {
      return manager;
    }
  }

  // Everything else is npm's: /usr/local/lib/node_modules, ~/.npm-global, the
  // per-version trees nvm and fnm keep, and %APPDATA%\npm on Windows.
  return "npm";
};

/**
 * Works out how Lantern was installed, from paths alone.
 *
 * Kept pure and away from the probing so the cases nobody can reproduce on
 * their own machine — a Cellar, a container built from the retired deb, yarn's
 * global root — are settled in tests. The order below is load-bearing and each
 * step says why it comes where it does.
 */
export const classifyInstallSource = (probe: InstallProbe): InstallSource => {
  const path = normalise(probe.scriptPath);

  // Lantern's *own* image, first: nothing inside it can be upgraded, only
  // replaced by pulling a newer one. It is deliberately narrower than "some
  // container" — a devcontainer or a CI image with a global npm install is a
  // normal install that happens to be containerised, and telling its owner to
  // pull an image they do not run would be worse than useless. The two tests
  // are the marker file and, for Podman and containerd which write none, the
  // /app tree and environment the Dockerfile bakes in.
  if (
    path.startsWith(CONTAINER_IMAGE_PREFIX) &&
    (probe.containerMarker || probe.env["LANTERN_ENV"] === "production")
  ) {
    return { kind: "docker" };
  }

  // Before any path test: a checkout can be anywhere, including inside a prefix
  // that would otherwise read as an install. This keys off the package root
  // rather than the entry name, so `pnpm dev:backend` lands here too.
  if (probe.gitMarker) {
    return { kind: "git-checkout", root: normalise(probe.packageRoot) };
  }

  if (NPX_CACHE_SEGMENTS.some((segment) => path.includes(segment))) {
    return { kind: "npx-cache" };
  }

  // Ahead of the npm test on purpose: the formula installs an npm tree inside
  // the Cellar, so both match, and only one of them can be upgraded safely.
  const cellar = path.indexOf(CELLAR_SEGMENT);
  if (cellar !== -1) {
    return { kind: "homebrew", prefix: path.slice(0, cellar) };
  }

  if (path.startsWith(SYSTEM_PACKAGE_PREFIX)) {
    return { kind: "system-package", manager: probe.systemPackageManager };
  }

  const packageSegment = path.indexOf(PACKAGE_SEGMENT);
  if (packageSegment !== -1) {
    const root = path.slice(0, packageSegment + "/node_modules".length);

    return { kind: "npm-global", manager: globalManager(path), root };
  }

  // Reported as-is rather than normalised: this one is shown to the user, who
  // has to recognise it as a path on their own machine.
  return { kind: "unknown", path: probe.scriptPath };
};

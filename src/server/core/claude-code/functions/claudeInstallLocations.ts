/**
 * Where `claude` lives when PATH does not carry it.
 *
 * A version manager keeps every global binary under the node version that
 * installed it, so switching node takes that whole directory off PATH. Lantern
 * needs node >=24 and Claude Code is usually installed under whatever node came
 * before it, which puts the two on different versions and `which claude` on
 * nothing — while the same machine still runs `claude` perfectly well from a
 * shell on the other version. Probing the directories installers actually write
 * to is what keeps topic naming working across that split.
 *
 * Pure, and handed its own `join` rather than reaching for `node:path`: the
 * ordering is the whole point and is worth testing without a filesystem, a home
 * directory or a platform behind it.
 */

/** The environment a lookup is allowed to read, resolved by the caller. */
export type ClaudeInstallEnv = {
  readonly home: string | undefined;
  readonly platform: NodeJS.Platform;
  readonly nvmDir: string | undefined;
  readonly fnmDir: string | undefined;
  readonly voltaHome: string | undefined;
  readonly pnpmHome: string | undefined;
  readonly xdgDataHome: string | undefined;
  /** Windows only: where npm puts global shims. */
  readonly appData: string | undefined;
};

/** A directory holding one subdirectory per installed node version. */
export type ClaudeVersionRoot = {
  readonly dir: string;
  /** What sits between a version directory and the executable. */
  readonly binSegments: readonly string[];
};

export type ClaudeInstallLocations = {
  /** Absolute paths to try as they are, best first. */
  readonly files: readonly string[];
  /** Roots whose every child may hold an executable, newest version first. */
  readonly versionRoots: readonly ClaudeVersionRoot[];
};

type Join = (...segments: string[]) => string;

/**
 * Windows resolves a bare command through PATHEXT, so a global install is a
 * `.cmd` shim next to a `.exe`; elsewhere there is only the one name.
 */
const executableNames = (platform: NodeJS.Platform): readonly string[] =>
  platform === "win32" ? ["claude.cmd", "claude.exe", "claude"] : ["claude"];

const versionParts = (name: string): readonly number[] | null => {
  const match = /^v?(\d+(?:\.\d+)*)$/.exec(name);
  if (match === null) return null;

  const digits = match[1];
  if (digits === undefined) return null;

  return digits.split(".").map(Number);
};

/**
 * Newest first, so a machine with several node versions installed is asked
 * about the one most likely to hold a current Claude Code.
 *
 * Names that are not versions — nvm's aliases, a stray directory — keep their
 * order and go last rather than being dropped: a lookup that ignores a
 * directory cannot find what is inside it.
 */
export const orderNodeVersionDirectories = (names: readonly string[]): readonly string[] => {
  const versions: { name: string; parts: readonly number[] }[] = [];
  const rest: string[] = [];

  for (const name of names) {
    const parts = versionParts(name);
    if (parts === null) {
      rest.push(name);
      continue;
    }
    versions.push({ name, parts });
  }

  versions.sort((left, right) => {
    const length = Math.max(left.parts.length, right.parts.length);
    for (let index = 0; index < length; index += 1) {
      const difference = (right.parts[index] ?? 0) - (left.parts[index] ?? 0);
      if (difference !== 0) return difference;
    }

    return 0;
  });

  return [...versions.map((version) => version.name), ...rest];
};

/**
 * Every place worth looking, ordered by how likely it is to be the install the
 * user actually means: their own home first, the system last.
 */
export const claudeInstallLocations = (
  env: ClaudeInstallEnv,
  join: Join,
): ClaudeInstallLocations => {
  const names = executableNames(env.platform);
  const files: string[] = [];
  const versionRoots: ClaudeVersionRoot[] = [];

  const addExecutablesIn = (directory: string | undefined): void => {
    if (directory === undefined) return;
    for (const name of names) {
      files.push(join(directory, name));
    }
  };

  const underHome = (...segments: string[]): string | undefined =>
    env.home === undefined ? undefined : join(env.home, ...segments);

  const shareDirectory = (...segments: string[]): string | undefined =>
    env.xdgDataHome === undefined
      ? underHome(".local", "share", ...segments)
      : join(env.xdgDataHome, ...segments);

  // Claude Code's own installers, which are version-manager independent and so
  // the answer that stays right when node changes underneath.
  addExecutablesIn(underHome(".claude", "local"));
  addExecutablesIn(underHome(".local", "bin"));

  addExecutablesIn(
    env.voltaHome === undefined ? underHome(".volta", "bin") : join(env.voltaHome, "bin"),
  );
  addExecutablesIn(env.pnpmHome ?? shareDirectory("pnpm"));

  if (env.platform === "win32") {
    if (env.appData !== undefined) {
      addExecutablesIn(join(env.appData, "npm"));
    }
  } else {
    addExecutablesIn("/opt/homebrew/bin");
    addExecutablesIn("/usr/local/bin");
    addExecutablesIn("/usr/bin");
  }

  const addVersionRoot = (dir: string | undefined, binSegments: readonly string[]): void => {
    if (dir === undefined) return;
    versionRoots.push({ dir, binSegments });
  };

  addVersionRoot(
    env.nvmDir === undefined
      ? underHome(".nvm", "versions", "node")
      : join(env.nvmDir, "versions", "node"),
    ["bin"],
  );
  addVersionRoot(
    env.fnmDir === undefined
      ? shareDirectory("fnm", "node-versions")
      : join(env.fnmDir, "node-versions"),
    ["installation", "bin"],
  );
  addVersionRoot(underHome(".asdf", "installs", "nodejs"), ["bin"]);

  return { files, versionRoots };
};

/** Every path a version root resolves to, newest node version first. */
export const versionRootCandidates = (
  root: ClaudeVersionRoot,
  versionDirectories: readonly string[],
  platform: NodeJS.Platform,
  join: Join,
): readonly string[] =>
  orderNodeVersionDirectories(versionDirectories).flatMap((version) =>
    executableNames(platform).map((name) => join(root.dir, version, ...root.binSegments, name)),
  );

/**
 * Enough of semver to decide whether the registry is offering something newer.
 *
 * Deliberately not the Claude Code version model in
 * `src/server/core/claude-code/models/ClaudeCode*`: that one drops the
 * prerelease part entirely, which is exactly the piece this has to get right —
 * a beta on the `latest` tag must not be offered to somebody on a release.
 */
export type SemanticVersion = {
  major: number;
  minor: number;
  patch: number;
  /** The `-beta.1` part, without its dash, or null for a release. */
  prerelease: string | null;
};

const versionPattern =
  /^v?(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<prerelease>[0-9A-Za-z-.]+))?(?:\+[0-9A-Za-z-.]+)?$/;

export const parseVersion = (raw: string): SemanticVersion | null => {
  const groups = raw.trim().match(versionPattern)?.groups;
  if (groups === undefined) {
    return null;
  }

  const [major, minor, patch] = [groups["major"], groups["minor"], groups["patch"]].map((value) =>
    Number.parseInt(value ?? "", 10),
  );

  if (major === undefined || minor === undefined || patch === undefined) {
    return null;
  }

  if ([major, minor, patch].some((value) => Number.isNaN(value))) {
    return null;
  }

  return { major, minor, patch, prerelease: groups["prerelease"] ?? null };
};

const compareNumbers = (a: number, b: number): number => (a === b ? 0 : a < b ? -1 : 1);

const compareRelease = (a: SemanticVersion, b: SemanticVersion): number =>
  compareNumbers(a.major, b.major) ||
  compareNumbers(a.minor, b.minor) ||
  compareNumbers(a.patch, b.patch);

/**
 * Orders `beta.9` before `beta.10`, the way semver does and the way a plain
 * string comparison does not: numeric identifiers compare as numbers, and a
 * numeric identifier always sorts below an alphanumeric one.
 */
const comparePrerelease = (a: string, b: string): number => {
  const left = a.split(".");
  const right = b.split(".");

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const one = left[index];
    const other = right[index];

    // A prerelease with fewer identifiers sorts first: beta < beta.1.
    if (one === undefined) {
      return -1;
    }
    if (other === undefined) {
      return 1;
    }
    if (one === other) {
      continue;
    }

    const oneNumber = /^\d+$/.test(one) ? Number.parseInt(one, 10) : null;
    const otherNumber = /^\d+$/.test(other) ? Number.parseInt(other, 10) : null;

    if (oneNumber !== null && otherNumber !== null) {
      return compareNumbers(oneNumber, otherNumber);
    }
    if (oneNumber !== null) {
      return -1;
    }
    if (otherNumber !== null) {
      return 1;
    }

    return one < other ? -1 : 1;
  }

  return 0;
};

const compareVersions = (a: SemanticVersion, b: SemanticVersion): number => {
  const release = compareRelease(a, b);
  if (release !== 0) {
    return release;
  }

  if (a.prerelease === b.prerelease) {
    return 0;
  }

  // 0.4.0 beats 0.4.0-beta.1: a release is the finished form of its prereleases.
  if (a.prerelease === null) {
    return 1;
  }
  if (b.prerelease === null) {
    return -1;
  }

  return comparePrerelease(a.prerelease, b.prerelease);
};

/**
 * Whether `candidate` is worth moving to from `current`.
 *
 * A prerelease is only ever offered to somebody already running one. Lantern's
 * betas share the `latest` dist-tag with its releases, so without this rule one
 * beta would offer itself to every user on the next launch.
 *
 * A version that cannot be read is not an upgrade: silence beats a wrong nudge.
 */
export const isUpgrade = (current: string, candidate: string): boolean => {
  const from = parseVersion(current);
  const to = parseVersion(candidate);

  if (from === null || to === null) {
    return false;
  }

  if (to.prerelease !== null && from.prerelease === null) {
    return false;
  }

  return compareVersions(to, from) > 0;
};

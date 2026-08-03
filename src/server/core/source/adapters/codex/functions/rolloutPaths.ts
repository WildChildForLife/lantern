import type { Path } from "@effect/platform";

/**
 * Codex names its files `rollout-<ISO timestamp>-<uuid>.jsonl`. The uuid is the
 * session, and it is the only part stable across a rename or a move into the
 * archive, so it is what Lantern keys on.
 */
export const rolloutSessionId = (filePath: string): string => {
  const fileName = filePath.split("/").at(-1) ?? filePath;
  const withoutExtension = fileName.replace(/\.jsonl$/, "");
  const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
    withoutExtension,
  );

  return uuid?.[1] ?? withoutExtension.replace(/^rollout-/, "");
};

const OFFSET_BASIS = 0x811c9dc5;
const PRIME = 0x01000193;

const hash32 = (input: string, seed: number): string => {
  let value = seed;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, PRIME) >>> 0;
  }
  return value.toString(16).padStart(8, "0");
};

/**
 * A project id for a source that has no project directory.
 *
 * Project ids are base64url of a path, decoded in a dozen places, so inventing
 * a prefix scheme would mean touching all of them. Instead a path is minted
 * that no source will ever create: `#` cannot start a directory Codex writes,
 * and the hash keeps one workspace mapping to one project across runs.
 */
export const virtualProjectPath = (
  path: Path.Path,
  rootPath: string,
  canonicalProjectPath: string,
): string =>
  path.join(
    rootPath,
    "#projects",
    `${hash32(canonicalProjectPath, OFFSET_BASIS)}${hash32(canonicalProjectPath, 0x9e3779b9)}`,
  );

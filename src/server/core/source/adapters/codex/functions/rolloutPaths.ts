import type { Path } from "@effect/platform";
import {
  FNV_OFFSET_BASIS,
  hash32,
} from "../../../../../../lib/conversation-schema/synthetic/entryIdentity.ts";

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
    `${hash32(canonicalProjectPath, FNV_OFFSET_BASIS)}${hash32(canonicalProjectPath, 0x9e3779b9)}`,
  );

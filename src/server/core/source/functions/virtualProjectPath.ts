import type { Path } from "@effect/platform";
import {
  FNV_OFFSET_BASIS,
  hash32,
} from "../../../../lib/conversation-schema/synthetic/entryIdentity.ts";

/**
 * A project id for a source that keeps no project directory.
 *
 * Codex and Copilot CLI both file every session in one flat directory and
 * record the working directory inside the transcript instead. Lantern's project
 * ids are base64url of a path, decoded in a dozen places, so inventing a prefix
 * scheme would mean touching all of them. A path is minted instead that no
 * source will ever create: `#` cannot start a directory either CLI writes, and
 * the hash keeps one workspace mapping to one project across runs.
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

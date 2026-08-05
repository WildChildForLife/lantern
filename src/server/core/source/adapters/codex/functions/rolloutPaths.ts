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

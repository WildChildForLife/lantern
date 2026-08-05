/**
 * One repo can be recorded several times: by two different agent CLIs, or by
 * the same CLI before and after the directory moved or was reached through a
 * different mount. This reduces a working directory to a comparable form so
 * those rows group into a single workspace.
 *
 * Deliberately pure — no symlink resolution. That needs the filesystem, gives
 * different answers on different machines, and would make the grouping depend
 * on when it was computed.
 *
 * The result is a grouping key and nothing else. It is lower-cased wherever the
 * filesystem is case-insensitive, so it must never be opened, joined onto, or
 * shown to anyone: use `projects.path` for that.
 */
export const canonicalizeProjectPath = (
  projectPath: string | null,
  options?: { readonly homeDirectory?: string | undefined; readonly platform?: string | undefined },
): string | null => {
  if (projectPath === null) {
    return null;
  }

  const trimmed = projectPath.trim();
  if (trimmed === "") {
    return null;
  }

  const home = options?.homeDirectory;
  const withHome =
    home !== undefined && home !== "" && (trimmed === "~" || trimmed.startsWith("~/"))
      ? `${home}${trimmed.slice(1)}`
      : trimmed;

  const posix = withHome.replaceAll("\\", "/");
  const isAbsolute = posix.startsWith("/");
  // `\\server\share` is one host's export, not a directory off the local root.
  const isUnc = posix.startsWith("//");
  // A Windows drive letter is part of the path, not a segment to case-fold away.
  const driveMatch = /^([a-zA-Z]):\//.exec(posix);

  const segments: string[] = [];
  for (const segment of posix.slice(driveMatch === null ? 0 : 3).split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      // A `..` with nothing to climb out of only survives on a relative path,
      // where dropping it would make `../api` and `api` the same workspace.
      if (segments.length === 0 || segments.at(-1) === "..") {
        if (!isAbsolute && driveMatch === null) segments.push("..");
        continue;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  const rootPrefix = isUnc ? "//" : "/";
  const prefix =
    driveMatch === null
      ? isAbsolute
        ? rootPrefix
        : ""
      : `${driveMatch[1]?.toLowerCase() ?? ""}:/`;
  const joined = `${prefix}${segments.join("/")}`;

  if (joined === "" || joined === "/" || joined === "//" || /^[a-z]:\/$/.test(joined)) {
    return joined === "" ? null : joined;
  }

  // Comparing case-sensitively on a case-insensitive filesystem would split one
  // repo into two workspaces.
  const platform = options?.platform;
  const caseInsensitive = platform === "darwin" || platform === "win32" || driveMatch !== null;

  return caseInsensitive ? joined.toLowerCase() : joined;
};

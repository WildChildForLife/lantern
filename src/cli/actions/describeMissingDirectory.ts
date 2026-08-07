/** A `C:\...` or `\\server\share` path, which no POSIX host can ever hold. */
const isWindowsPath = (path: string): boolean =>
  /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");

/**
 * Why a conversation cannot be resumed where it was recorded.
 *
 * Two different situations read the same way otherwise. A directory that has
 * been deleted might come back, and moving it is the user's own doing. A path
 * recorded by Claude Code on another machine — `C:\Users\…` read from Linux —
 * never existed here and never will, and saying "no longer exists" about it
 * sends the user looking for something they never lost.
 */
export const describeMissingDirectory = (cwd: string, platform: NodeJS.Platform): string => {
  if (platform !== "win32" && isWindowsPath(cwd)) {
    return `${cwd} belongs to another machine, so this conversation cannot be resumed from here`;
  }

  return `${cwd} no longer exists, and Claude Code finds a conversation by the directory it ran in`;
};

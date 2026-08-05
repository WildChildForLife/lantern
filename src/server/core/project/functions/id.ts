const toPosixPath = (filePath: string): string => filePath.replaceAll("\\", "/");

const getDirname = (filePath: string): string => {
  const normalized = toPosixPath(filePath);
  const lastSlashIndex = normalized.lastIndexOf("/");
  if (lastSlashIndex === -1) {
    return ".";
  }
  if (lastSlashIndex === 0) {
    return "/";
  }
  return normalized.slice(0, lastSlashIndex);
};

const normalizeAbsolutePath = (inputPath: string): string => {
  const normalizedInput = toPosixPath(inputPath);
  const isAbsolute = normalizedInput.startsWith("/");
  const rawSegments = normalizedInput.split("/");
  const resolvedSegments: string[] = [];

  for (const segment of rawSegments) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (resolvedSegments.length > 0) {
        resolvedSegments.pop();
      }
      continue;
    }
    resolvedSegments.push(segment);
  }

  const normalized = `${isAbsolute ? "/" : ""}${resolvedSegments.join("/")}`;
  if (normalized === "") {
    return isAbsolute ? "/" : ".";
  }
  return normalized;
};

export const encodeProjectId = (fullPath: string) => {
  return Buffer.from(fullPath).toString("base64url");
};

export const decodeProjectId = (id: string) => {
  return Buffer.from(id, "base64url").toString("utf-8");
};

export const encodeProjectIdFromSessionFilePath = (sessionFilePath: string) => {
  return encodeProjectId(getDirname(sessionFilePath));
};

/**
 * Whether a decoded project path lies inside one of the directories Lantern is
 * allowed to read, so a crafted projectId cannot walk out of them.
 *
 * The roots come from the registered source adapters — server state, never a
 * request — and a path only has to be inside one of them.
 */
export const validateProjectPath = (
  decodedPath: string,
  allowedRoots: string | readonly string[],
): boolean => {
  const normalizedPath = normalizeAbsolutePath(decodedPath);
  const roots = typeof allowedRoots === "string" ? [allowedRoots] : allowedRoots;

  return roots.some((root) => {
    const normalizedBase = normalizeAbsolutePath(root);
    return normalizedPath === normalizedBase || normalizedPath.startsWith(`${normalizedBase}/`);
  });
};

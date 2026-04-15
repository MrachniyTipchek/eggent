import path from "path";

export function isDirectoryPrefix(
  resolvedPath: string,
  resolvedBaseDir: string
): boolean {
  const base = path.resolve(resolvedBaseDir);
  const candidate = path.resolve(resolvedPath);
  return candidate === base || candidate.startsWith(base + path.sep);
}

export function resolvePathInsideDirectory(
  baseDir: string,
  relativePath: string
): string | null {
  const baseResolved = path.resolve(baseDir);
  const raw = relativePath.trim();
  if (!raw) {
    return baseResolved;
  }
  if (path.isAbsolute(raw)) {
    return null;
  }
  const normalized = path.normalize(raw);
  const segments = normalized.split(path.sep);
  if (segments.some((s) => s === "..")) {
    return null;
  }
  const joined = path.resolve(baseResolved, normalized);
  if (!isDirectoryPrefix(joined, baseResolved)) {
    return null;
  }
  return joined;
}

const PROJECT_DIR_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,191}$/;

export function isSafeProjectDirectoryId(projectId: string): boolean {
  const t = projectId.trim();
  if (!t || t === "none") {
    return false;
  }
  return PROJECT_DIR_ID_PATTERN.test(t);
}

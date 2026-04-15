const MEMORY_SUBDIR_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,191}$/;

export function normalizeMemorySubdir(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  if (!MEMORY_SUBDIR_PATTERN.test(t)) return null;
  return t;
}

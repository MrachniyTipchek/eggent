import path from "path";
import { resolvePathInsideDirectory } from "@/lib/storage/path-utils";

export function getProjectKnowledgeDir(projectId: string): string {
  return path.join(
    process.cwd(),
    "data",
    "projects",
    projectId,
    ".meta",
    "knowledge"
  );
}

export function resolveKnowledgeFilePath(
  knowledgeDir: string,
  rawName: string
): string | null {
  const name = path.basename(rawName.trim());
  if (!name || name === "." || name === "..") {
    return null;
  }
  return resolvePathInsideDirectory(knowledgeDir, name);
}

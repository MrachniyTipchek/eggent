import { NextRequest } from "next/server";
import fs from "fs/promises";
import { getProjectFiles, getWorkDir } from "@/lib/storage/project-store";
import { publishUiSyncEvent } from "@/lib/realtime/event-bus";
import { resolvePathInsideDirectory } from "@/lib/storage/path-utils";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("project");
  const subPath = req.nextUrl.searchParams.get("path") || "";

  if (!projectId) {
    return Response.json(
      { error: "Project ID required" },
      { status: 400 }
    );
  }

  const files = await getProjectFiles(projectId, subPath);
  return Response.json(files);
}

export async function DELETE(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("project");
  const filePath = req.nextUrl.searchParams.get("path");

  if (!projectId || !filePath) {
    return Response.json(
      { error: "Project ID and file path required" },
      { status: 400 }
    );
  }

  const workDir = getWorkDir(projectId);
  const resolvedTarget = resolvePathInsideDirectory(workDir, filePath);
  if (!resolvedTarget) {
    return Response.json({ error: "Invalid file path" }, { status: 403 });
  }

  try {
    const stat = await fs.stat(resolvedTarget);
    if (stat.isDirectory()) {
      await fs.rm(resolvedTarget, { recursive: true });
    } else {
      await fs.unlink(resolvedTarget);
    }
    publishUiSyncEvent({
      topic: "files",
      projectId: projectId === "none" ? null : projectId,
      reason: "file_deleted",
    });
    return Response.json({ success: true });
  } catch {
    return Response.json({ error: "File not found" }, { status: 404 });
  }
}

import { NextRequest } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getWorkDir } from "@/lib/storage/project-store";
import { resolvePathInsideDirectory } from "@/lib/storage/path-utils";

export async function GET(req: NextRequest) {
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
    const content = await fs.readFile(resolvedTarget);
    const fileName = path.basename(resolvedTarget);

    return new Response(content, {
      headers: {
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Type": "application/octet-stream",
      },
    });
  } catch {
    return Response.json({ error: "File not found" }, { status: 404 });
  }
}

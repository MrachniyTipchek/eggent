import { NextRequest } from "next/server";
import {
  searchMemory,
  insertMemory,
  deleteMemoryById,
  getAllMemories,
} from "@/lib/memory/memory";
import { getSettings } from "@/lib/storage/settings-store";
import { normalizeMemorySubdir } from "@/lib/memory/memory-subdir";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query");
  const subdirRaw = req.nextUrl.searchParams.get("subdir") || "main";
  const subdir = normalizeMemorySubdir(subdirRaw);
  if (!subdir) {
    return Response.json({ error: "Invalid subdir" }, { status: 400 });
  }
  const limitRaw = parseInt(req.nextUrl.searchParams.get("limit") || "20", 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(200, Math.max(1, limitRaw))
    : 20;

  if (query) {
    const settings = await getSettings();
    const results = await searchMemory(
      query,
      limit,
      settings.memory.similarityThreshold,
      subdir,
      settings
    );
    return Response.json(results);
  }

  // Return all memories for dashboard
  const memories = await getAllMemories(subdir);
  return Response.json(memories);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, area, subdir: subdirBody } = body;
    const subdir = normalizeMemorySubdir(subdirBody ?? "main");
    if (!subdir) {
      return Response.json({ error: "Invalid subdir" }, { status: 400 });
    }

    if (!text) {
      return Response.json({ error: "Text is required" }, { status: 400 });
    }

    const settings = await getSettings();
    const id = await insertMemory(
      text,
      area || "main",
      subdir,
      settings
    );

    return Response.json({ id, success: true }, { status: 201 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to save memory",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const subdir = normalizeMemorySubdir(
    req.nextUrl.searchParams.get("subdir") || "main"
  );
  if (!subdir) {
    return Response.json({ error: "Invalid subdir" }, { status: 400 });
  }

  if (!id) {
    return Response.json({ error: "Memory ID required" }, { status: 400 });
  }

  const deleted = await deleteMemoryById(id, subdir);
  if (!deleted) {
    return Response.json({ error: "Memory not found" }, { status: 404 });
  }

  return Response.json({ success: true });
}

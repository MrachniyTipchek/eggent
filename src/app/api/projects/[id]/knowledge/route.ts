
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { importKnowledgeFile } from "@/lib/memory/knowledge";
import { deleteMemoryByMetadata, getChunkCountsByFilename } from "@/lib/memory/memory";
import {
    getProjectKnowledgeDir,
    resolveKnowledgeFilePath,
} from "@/lib/projects/knowledge-paths";
import { getProject } from "@/lib/storage/project-store";
import { getSettings } from "@/lib/storage/settings-store";

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const project = await getProject(id);
    if (!project) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const knowledgeDir = getProjectKnowledgeDir(id);

    try {
        await fs.access(knowledgeDir);
    } catch {
        return NextResponse.json([]);
    }

    try {
        const files = await fs.readdir(knowledgeDir);
        const chunkCounts = await getChunkCountsByFilename(id);
        const fileDetails = await Promise.all(
            files.map(async (file) => {
                const resolved = resolveKnowledgeFilePath(knowledgeDir, file);
                if (!resolved) {
                    return null;
                }
                const stats = await fs.stat(resolved);
                return {
                    name: path.basename(resolved),
                    size: stats.size,
                    createdAt: stats.birthtime,
                    chunkCount: chunkCounts[path.basename(resolved)] ?? 0,
                };
            })
        );
        return NextResponse.json(fileDetails.filter(Boolean));
    } catch (error) {
        return NextResponse.json(
            { error: "Failed to list knowledge files" },
            { status: 500 }
        );
    }
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    // Verify project exists
    const project = await getProject(id);
    if (!project) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const knowledgeDir = getProjectKnowledgeDir(id);

    // Ensure knowledge directory exists
    await fs.mkdir(knowledgeDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = path.basename(file.name.trim());
    const filePath = resolveKnowledgeFilePath(knowledgeDir, safeName);
    if (!filePath || !safeName) {
        return NextResponse.json({ error: "Invalid file name" }, { status: 400 });
    }

    try {
        // Save file
        await fs.writeFile(filePath, buffer);

        // Ingest only the uploaded file (removes its old chunks first, so no duplicates)
        const settings = await getSettings();
        const result = await importKnowledgeFile(knowledgeDir, id, settings, safeName);

        if (result.errors.length > 0) {
            console.error("Ingestion errors:", result.errors);
            return NextResponse.json(
                {
                    message: "File saved but ingestion had errors",
                    details: result
                },
                { status: 207 } // Multi-Status
            );
        }

        return NextResponse.json({
            message: "File uploaded and ingested successfully",
            filename: safeName
        });

    } catch (error) {
        console.error("Upload error:", error);
        return NextResponse.json(
            { error: "Failed to process file" },
            { status: 500 }
        );
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    // Verify project exists
    const project = await getProject(id);
    if (!project) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    try {
        const { filename } = await req.json();

        if (!filename) {
            return NextResponse.json({ error: "Filename is required" }, { status: 400 });
        }

        const knowledgeDir = getProjectKnowledgeDir(id);
        const safeName = path.basename(String(filename).trim());
        const filePath = resolveKnowledgeFilePath(knowledgeDir, safeName);
        if (!filePath || !safeName) {
            return NextResponse.json({ error: "Invalid file name" }, { status: 400 });
        }

        // Delete file from disk
        try {
            await fs.unlink(filePath);
        } catch (error: any) {
            if (error.code !== "ENOENT") {
                throw error;
            }
            // If file doesn't exist, we still try to delete vectors
        }

        // Delete vectors
        const deletedVectors = await deleteMemoryByMetadata("filename", safeName, id);

        return NextResponse.json({
            message: "File and vectors deleted successfully",
            deletedVectors
        });

    } catch (error) {
        console.error("Delete error:", error);
        return NextResponse.json(
            { error: "Failed to delete file" },
            { status: 500 }
        );
    }
}

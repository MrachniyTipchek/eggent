import { NextRequest } from "next/server";
import {
  generateExternalApiToken,
  getExternalApiToken,
  getExternalApiTokenStatus,
  markExternalApiTokenRevealed,
  maskExternalApiToken,
  saveExternalApiToken,
} from "@/lib/storage/external-api-token-store";

function resolveEnvToken(): string | null {
  const envToken = process.env.EXTERNAL_API_TOKEN?.trim();
  return envToken || null;
}

export async function GET() {
  const storedStatus = await getExternalApiTokenStatus();
  if (storedStatus.configured) {
    return Response.json({
      configured: true,
      source: "stored" as const,
      maskedToken: storedStatus.maskedToken,
      updatedAt: storedStatus.updatedAt,
      lastRevealedAt: storedStatus.lastRevealedAt,
    });
  }

  const envToken = resolveEnvToken();
  if (envToken) {
    return Response.json({
      configured: true,
      source: "env" as const,
      maskedToken: maskExternalApiToken(envToken),
      updatedAt: null as string | null,
      lastRevealedAt: null as string | null,
    });
  }

  return Response.json({
    configured: false,
    source: "none" as const,
    maskedToken: null,
    updatedAt: null as string | null,
    lastRevealedAt: null as string | null,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { rotate?: unknown };
    const rotateRequested = body?.rotate === true;
    const existing = await getExternalApiToken();
    if (existing && !rotateRequested) {
      const status = await getExternalApiTokenStatus();
      return Response.json(
        {
          error: "Token rotation requires rotate: true in the JSON body.",
          configured: true,
          maskedToken: status.maskedToken,
          lastRevealedAt: status.lastRevealedAt,
        },
        { status: 409 }
      );
    }

    const token = generateExternalApiToken();
    await saveExternalApiToken(token);
    await markExternalApiTokenRevealed();

    return Response.json({
      success: true,
      token,
      maskedToken: maskExternalApiToken(token),
      source: "stored" as const,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate token",
      },
      { status: 500 }
    );
  }
}

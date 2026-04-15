import { embed, embedMany } from "ai";
import { createEmbeddingModel } from "@/lib/providers/llm-provider";

const EMBEDDING_CACHE_MAX = 64;
const embeddingCache = new Map<string, Promise<number[][]>>();
const embeddingCacheOrder: string[] = [];

function touchEmbeddingCache(key: string) {
  const idx = embeddingCacheOrder.indexOf(key);
  if (idx >= 0) {
    embeddingCacheOrder.splice(idx, 1);
  }
  embeddingCacheOrder.push(key);
  while (embeddingCacheOrder.length > EMBEDDING_CACHE_MAX) {
    const oldest = embeddingCacheOrder.shift();
    if (oldest) embeddingCache.delete(oldest);
  }
}

/**
 * Generate embeddings for an array of texts
 */
export async function embedTexts(
  texts: string[],
  config: {
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
    dimensions?: number;
  }
): Promise<number[][]> {
  try {
    if (config.provider !== "mock" && texts.length === 1) {
      const key = [
        config.provider,
        config.model,
        String(config.dimensions ?? ""),
        config.baseUrl ?? "",
        texts[0],
      ].join("\0");
      const hit = embeddingCache.get(key);
      if (hit) {
        touchEmbeddingCache(key);
        return hit;
      }
      const pending = (async () => {
        const model = createEmbeddingModel(config);
        const { embedding } = await embed({
          model,
          value: texts[0],
        });
        return [embedding];
      })();
      embeddingCache.set(key, pending);
      touchEmbeddingCache(key);
      return pending;
    }
    if (config.provider === "mock") {
      const dim = config.dimensions || 1536;
      const count = texts.length;
      // Return random normalized vectors
      return Array(count).fill(0).map(() => {
        const vec = Array(dim).fill(0).map(() => Math.random() - 0.5);
        const norm = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
        return vec.map(v => v / norm);
      });
    }

    const model = createEmbeddingModel(config);
    const { embeddings } = await embedMany({
      model,
      values: texts,
    });
    return embeddings;
  } catch (error) {
    console.error("Embedding error:", error);
    throw new Error(
      `Failed to generate embeddings: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

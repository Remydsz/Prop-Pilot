import "dotenv/config";
import OpenAI from "openai";

const FALLBACK_DIM = 1536;

/**
 * Returns embeddings for each input text.
 * - If OPENAI_API_KEY is set, uses text-embedding-3-small.
 * - Otherwise, generates deterministic pseudo-embeddings so everything still works.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return texts.map(t => pseudoEmbedding(t, FALLBACK_DIM));

  const client = new OpenAI({ apiKey: key });
  const model = "text-embedding-3-small";
  const res = await client.embeddings.create({ model, input: texts });
  return res.data.map(d => d.embedding as number[]);
}

function pseudoEmbedding(s: string, dim: number): number[] {
  // Simple deterministic hash-based vector so search/dev works without a key.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0; // FNV-ish
  }
  const out = new Array(dim);
  for (let i = 0; i < dim; i++) out[i] = Math.sin((h + i) * 0.000113) as number;
  return out;
}

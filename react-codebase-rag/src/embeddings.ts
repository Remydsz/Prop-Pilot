import "dotenv/config";

const OLLAMA_URL =
  process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/embeddings';
const OLLAMA_EMBED_MODEL =
  process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';


// Use global fetch if available (Node 18+). Otherwise fall back to node-fetch.
let _fetch: any = (globalThis as any).fetch;
if (!_fetch) {
  try {
    _fetch = require("node-fetch");
  } catch {
    throw new Error("No global fetch found. Install node-fetch: npm i node-fetch");
  }
}
const fetch = _fetch as typeof globalThis.fetch;

// Conditionally load OpenAI only if needed (avoid ESM import issues in CJS)
let OpenAICtor: any = null;
function getOpenAI() {
  if (OpenAICtor) return OpenAICtor;
  try {
    const mod = require("openai");              // CJS-safe
    OpenAICtor = mod.default || mod;
  } catch {
    OpenAICtor = null;
  }
  return OpenAICtor;
}

const OLLAMA_DEFAULT_URL = "http://localhost:11434/api/embeddings";
const OLLAMA_DEFAULT_MODEL = "nomic-embed-text";
const FALLBACK_DIM = 768; // nomic-embed-text: 768-dim

type Provider = "ollama" | "openai" | "pseudo";

function provider(): Provider {
  const p = (process.env.EMBEDDINGS_PROVIDER || "").toLowerCase();
  if (p === "ollama") return "ollama";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "pseudo";
}

export async function embed(texts: string[]): Promise<number[][]> {
  const p = provider();
  if (p === "ollama") return embedWithOllama(texts);
  if (p === "openai") return embedWithOpenAI(texts);
  return texts.map(t => pseudoEmbedding(t, FALLBACK_DIM));
}

async function embedWithOllama(texts: string[]): Promise<number[][]> {
  const model = process.env.OLLAMA_EMBED_MODEL || OLLAMA_DEFAULT_MODEL;
  const url = process.env.OLLAMA_URL || OLLAMA_DEFAULT_URL;

  const out: number[][] = [];
  for (const input of texts) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: input })
      } as any);
      if (!res.ok) {
        const body = await res.text();
        console.warn("Ollama embed error", res.status, body);
        out.push(pseudoEmbedding(input, FALLBACK_DIM));
        continue;
      }
      const json: any = await res.json();
      out.push(json.embedding);
    } catch (e: any) {
      console.warn("Ollama fetch failed:", e?.message || e);
      out.push(pseudoEmbedding(input, FALLBACK_DIM));
    }
  }
  return out;
}

async function embedWithOpenAI(texts: string[]): Promise<number[][]> {
  const OpenAI = getOpenAI();
  if (!OpenAI) {
    console.warn("OpenAI SDK not available, falling back to pseudo embeddings.");
    return texts.map(t => pseudoEmbedding(t, FALLBACK_DIM));
  }
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
    const res = await client.embeddings.create({ model, input: texts });
    return res.data.map((d: any) => d.embedding as number[]);
  } catch (err: any) {
    console.warn("⚠️ OpenAI embeddings failed, fallback to pseudo:", err?.message || err);
    return texts.map(t => pseudoEmbedding(t, FALLBACK_DIM));
  }
}

function pseudoEmbedding(s: string, dim: number): number[] {
  // Deterministic hash → sinusoid vector (keeps pipeline working w/o external deps)
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const out = new Array(dim);
  for (let i = 0; i < dim; i++) out[i] = Math.sin((h + i) * 0.000113);
  return out;
}

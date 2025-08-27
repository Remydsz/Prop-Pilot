// src/search.ts
import fs from "fs";
import path from "path";
import "dotenv/config";

type ComponentInfo = {
  name: string;
  file: string;
  code: string;
  embedding: number[];
};

const OLLAMA_URL =
  process.env.OLLAMA_URL || "http://127.0.0.1:11434/api/embeddings";
const MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";

async function embed(text: string): Promise<number[]> {
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt: text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Ollama embed failed: ${res.status} ${res.statusText} ${body ? `- ${body}` : ""}`.trim()
    );
  }
  const json: any = await res.json();
  if (!json?.embedding || !Array.isArray(json.embedding)) {
    throw new Error(`Ollama response missing "embedding" array.`);
  }
  return json.embedding as number[];
}

function cosineSimilarity(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function loadComponents(indexPath: string): ComponentInfo[] {
  const raw = fs.readFileSync(indexPath, "utf8").trim();
  if (!raw) throw new Error(`Index file is empty: ${indexPath}`);

  let parsed: any;
  // Try parse as single JSON value
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Fallback: JSONL (one JSON per line)
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    parsed = lines;
  }

  const arr: any[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.components)
    ? parsed.components
    : [];

  if (!Array.isArray(arr)) {
    const keys = parsed && typeof parsed === "object" ? Object.keys(parsed) : [];
    throw new Error(
      `Index format not recognized. Expected array or {components:[...]}. Got keys: ${keys.join(", ")}`
    );
  }

  // Basic sanity filter
  const components = arr.filter(
    (c) =>
      c &&
      typeof c.name === "string" &&
      typeof c.file === "string" &&
      typeof c.code === "string" &&
      Array.isArray(c.embedding)
  );

  if (components.length === 0) {
    throw new Error(
      `No valid components found. First entry (if any): ${arr[0] ? JSON.stringify(arr[0]).slice(0, 200) + "..." : "none"}`
    );
  }

  return components as ComponentInfo[];
}

async function main() {
  const query = process.argv.slice(2).join(" ");
  if (!query) {
    console.error("Usage: npm run search -- \"your query\"");
    process.exit(1);
  }

  const dataPath = path.join("data", "index.json");

  let components: ComponentInfo[];
  try {
    components = loadComponents(dataPath);
  } catch (e: any) {
    console.error(`Failed to load index from ${dataPath}: ${e?.message || e}`);
    process.exit(1);
    return;
  }

  console.log(`Loaded ${components.length} components from ${dataPath}`);

  let queryEmbedding: number[];
  try {
    queryEmbedding = await embed(query);
  } catch (e: any) {
    console.error(`Embedding error: ${e?.message || e}`);
    process.exit(1);
    return;
  }

  const results = components
    .map((c) => ({
      ...c,
      score: cosineSimilarity(queryEmbedding, c.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  console.log(`\nTop results for: "${query}"\n`);
  results.forEach((r, i) => {
    console.log(`#${i + 1} ${r.name} (${r.file})`);
    console.log(`Score: ${r.score.toFixed(3)}`);
    console.log(r.code.split("\n").slice(0, 10).join("\n")); // first 10 lines
    console.log("----\n");
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

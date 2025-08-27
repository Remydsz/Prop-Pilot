// src/server.ts
import fs from "fs";
import path from "path";
import express from "express";
import fetch from "node-fetch";
import "dotenv/config";
import cors from "cors";

// ---------- types ----------
type ComponentInfo = {
  name: string;
  file: string;
  code: string;
  embedding: number[];
};

// ---------- env & constants ----------
const PORT = Number(process.env.PORT || 3333);
const OLLAMA_BASE = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
const GEN_MODEL = process.env.OLLAMA_GEN_MODEL || "phi3:mini"; // tiny default
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

// keep the model light & fast
const GEN_OPTIONS = {
  temperature: 0.0,
  top_k: 40,
  top_p: 0.9,
  repeat_penalty: 1.1,
  num_ctx: 1024,     // cap prompt context
  num_predict: 192,  // cap output
  // you can add num_threads via env (OLLAMA_NUM_THREADS) at the Ollama level
};

const REQ_TIMEOUT_MS = 15000; // guardrail for local calls

// ---------- utils ----------
function cosine(a: number[], b: number[]) {
  const dot = a.reduce((s, v, i) => s + v * b[i], 0);
  const na = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const nb = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  return dot / (na * nb || 1);
}

function truncateCode(code: string, maxChars = 900) {
  return code.length <= maxChars ? code : code.slice(0, maxChars) + "\n/* …truncated… */";
}

async function withTimeout<T>(p: Promise<T>, ms = REQ_TIMEOUT_MS): Promise<T> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    // @ts-ignore node-fetch accepts AbortController.signal
    return await p.then((res: any) => res);
  } finally {
    clearTimeout(t);
  }
}

async function ollamaEmbed(text: string): Promise<number[]> {
  const res = await withTimeout(
    fetch(`${OLLAMA_BASE}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
    })
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`embed failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ""}`);
  }
  const json = await res.json();
  if (!Array.isArray(json?.embedding)) throw new Error("No embedding array in response");
  return json.embedding;
}

async function ollamaGenerate(prompt: string): Promise<string> {
  const res = await withTimeout(
    fetch(`${OLLAMA_BASE}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GEN_MODEL,
        prompt,
        stream: false,
        keep_alive: "2m",
        options: GEN_OPTIONS,
      }),
    })
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`generate failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ""}`);
  }
  const json: any = await res.json();
  return (json.response || "").trim();
}

// ---------- load index ----------
const dataPath = path.join(process.cwd(), "data", "index.json");
if (!fs.existsSync(dataPath)) {
  console.error(`Missing ${dataPath}. Run: npm run ingest`);
  process.exit(1);
}
const INDEX: ComponentInfo[] = JSON.parse(fs.readFileSync(dataPath, "utf8"));

// ---------- app ----------
const app = express();
app.use(express.json());
app.use(cors());

app.use(cors({
    origin: CORS_ORIGIN,
    methods: ["GET","POST","PUT","DELETE","OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));
app.options("*", cors());

app.get("/healthz", (_req, res) => res.status(200).end());

// GET /search?q=...&topK=5&scope=examples|src|all
app.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const topK = Math.min(50, Math.max(1, Number(req.query.topK || 5)));
    const scope = String(req.query.scope || "all");

    if (!q) return res.status(400).json({ error: "missing q" });

    let pool = INDEX;
    if (scope === "examples") {
      pool = pool.filter((c) => c.file.includes("examples/"));
    } else if (scope === "src") {
      pool = pool.filter(
        (c) =>
          c.file.includes("packages/react-router") ||
          c.file.includes("packages/react-router-dom")
      );
    }

    const qVec = await ollamaEmbed(q);
    const ranked = pool
      .map((c) => ({ ...c, score: cosine(qVec, c.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((r) => ({
        name: r.name,
        file: r.file,
        score: r.score,
        preview: r.code.split("\n").slice(0, 18).join("\n"),
      }));

    res.json({ query: q, count: pool.length, results: ranked });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// GET /component?name=...&file=...
app.get("/component", (req, res) => {
  const name = String(req.query.name || "");
  const file = String(req.query.file || "");
  const hit = INDEX.find((c) => c.name === name && c.file === file);
  if (!hit) return res.status(404).json({ error: "not found" });
  res.json({ name: hit.name, file: hit.file, code: hit.code });
});

// GET /answer?q=...&scope=examples|src|all&topK=5
app.get("/answer", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const scope = String(req.query.scope || "all");
    const topK = Math.min(6, Math.max(1, Number(req.query.topK || 4))); // small K keeps context tiny

    if (!q) return res.status(400).json({ error: "missing q" });

    let pool = INDEX;
    if (scope === "examples") {
      pool = pool.filter((c) => c.file.includes("examples/"));
    } else if (scope === "src") {
      pool = pool.filter(
        (c) =>
          c.file.includes("packages/react-router") ||
          c.file.includes("packages/react-router-dom")
      );
    }

    const qVec = await ollamaEmbed(q);
    const ranked = pool
      .map((c) => ({ ...c, score: cosine(qVec, c.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    const context = ranked
      .map(
        (r, i) =>
          `### Context ${i + 1}: ${r.name} — ${r.file}\n\`\`\`tsx\n${truncateCode(
            r.code,
            700
          )}\n\`\`\``
      )
      .join("\n\n");

    const system = `You are a senior React/TypeScript mentor.
Answer the question using only the provided context from the codebase.
Be concise (~300 words max), cite component names inline, and show a minimal code example when helpful.`;

    const prompt = `${system}

# Question
${q}

# Retrieved context
${context}

# Answer (concise):`;

    const answer = await ollamaGenerate(prompt);

    res.json({
      query: q,
      scope,
      used: ranked.map((r) => ({ name: r.name, file: r.file, score: r.score })),
      answer,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});

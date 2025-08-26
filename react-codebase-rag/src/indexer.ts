import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { findSourceFiles } from "./walk";
import { extractComponents } from "./ast";
import { embed } from "./embeddings";
import { ComponentInfo, IndexFile } from "./types";

const OUT_DIR = "data";
const OUT_FILE = path.join(OUT_DIR, "index.json");

async function main() {
  const root = process.env.CODEBASE_DIR;
  if (!root) {
    console.error("ERROR: Set CODEBASE_DIR in your .env (absolute path to a React repo).");
    process.exit(1);
  }

  console.log("Scanning:", root);
  const files = await findSourceFiles(root);

  const components: ComponentInfo[] = [];
  for (const f of files) {
    const cs = extractComponents(f);
    if (cs.length) components.push(...cs);
  }
  console.log(`Parsed ${files.length} files → ${components.length} components`);

  // Build text for embeddings: summary + small code slice
  const texts = components.map(c => `${c.summary}\n${c.codeSnippet.slice(0, 400)}`);
  const vectors = texts.length ? await embed(texts) : [];

  components.forEach((c, i) => {
    c.embedding = vectors[i];
  });

  const idx: IndexFile = {
    createdAt: new Date().toISOString(),
    components,
    dim: vectors[0]?.length ?? 0
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(idx, null, 2));
  console.log("Wrote", OUT_FILE);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

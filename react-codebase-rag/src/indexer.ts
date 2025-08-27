// src/indexer.ts
import fg from "fast-glob";
import fs from "fs";
import path from "path";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import fetch from "node-fetch"; // <— ensure fetch exists under ts-node CJS
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

// --- helpers -------------------------------------------------------------

function isCapitalized(name?: string) {
  return !!name && /^[A-Z]/.test(name);
}

function readFileSafe(fp: string) {
  try {
    return fs.readFileSync(fp, "utf8");
  } catch {
    return "";
  }
}

async function embed(text: string): Promise<number[]> {
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt: text }),
  } as any);
  if (!res.ok) {
    const body = await (res as any).text().catch(() => "");
    throw new Error(
      `Ollama embed failed: ${res.status} ${res.statusText} ${body ? `- ${body}` : ""}`.trim()
    );
  }
  const json: any = await (res as any).json();
  if (!json?.embedding || !Array.isArray(json.embedding)) {
    throw new Error(`Ollama response missing "embedding" array.`);
  }
  return json.embedding as number[];
}

// Extract components: function decl, arrow function, class extends React.Component
function extractComponents(_filePath: string, source: string) {
  const components: { name: string; code: string }[] = [];

  let ast;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: [
        "jsx",
        "typescript",
        "classProperties",
        "decorators-legacy",
        "objectRestSpread",
        "optionalChaining",
        "nullishCoalescingOperator",
        "dynamicImport",
        "importMeta",
        "topLevelAwait",
      ],
    });
  } catch {
    return components; // skip unparseable files
  }

  // quick helper to see if a node subtree contains JSX
  function nodeHasJSX(p: any): boolean {
    let found = false;
    p.traverse({
      JSXElement() {
        found = true;
      },
      JSXFragment() {
        found = true;
      },
    });
    return found;
  }

  traverse(ast, {
    // function Component() { return (<div/>); }
    FunctionDeclaration(path) {
      const name = path.node.id?.name;
      if (!isCapitalized(name)) return;
      if (!nodeHasJSX(path)) return;

      const start = (path.node.start ?? 0) as number;
      const end = (path.node.end ?? source.length) as number;
      const code = source.slice(start, end).trim();
      components.push({ name: name!, code });
    },

    // const Component = () => (<div/>)
    // const Component = function () { return <div/> }
    VariableDeclarator(path) {
      const id: any = path.node.id;
      const init: any = path.node.init;
      const name = id?.name as string | undefined;
      if (!isCapitalized(name)) return;
      if (!init) return;

      const isArrow = init.type === "ArrowFunctionExpression";
      const isFuncExpr = init.type === "FunctionExpression";
      if (!isArrow && !isFuncExpr) return;

      // detect JSX under this variable’s initializer
      let hasJSX = false;
      try {
        path.traverse({
          JSXElement() {
            hasJSX = true;
          },
          JSXFragment() {
            hasJSX = true;
          },
        });
      } catch {
        // ignore
      }
      if (!hasJSX) return;

      const start = (init.start ?? 0) as number;
      const end = (init.end ?? source.length) as number;
      const code = source.slice(start, end).trim();
      components.push({ name: name!, code });
    },

    // class Component extends React.Component { render(){ return <div/> } }
    ClassDeclaration(path) {
      const name = path.node.id?.name;
      if (!isCapitalized(name)) return;

      let extendsReact = false;
      const superClass: any = path.node.superClass;
      if (superClass) {
        if (
          (superClass.type === "MemberExpression" &&
            superClass.object?.name === "React" &&
            (superClass.property?.name === "Component" ||
              superClass.property?.name === "PureComponent")) ||
          (superClass.type === "Identifier" &&
            (superClass.name === "Component" ||
              superClass.name === "PureComponent"))
        ) {
          extendsReact = true;
        }
      }
      if (!extendsReact) return;

      // ensure render has JSX
      let hasJSX = false;
      path.traverse({
        ClassMethod(p) {
          const key: any = p.node.key;
          if (p.node.kind === "method" && key?.name === "render") {
            p.traverse({
              JSXElement() {
                hasJSX = true;
              },
              JSXFragment() {
                hasJSX = true;
              },
            });
          }
        },
      });
      if (!hasJSX) return;

      const start = (path.node.start ?? 0) as number;
      const end = (path.node.end ?? source.length) as number;
      const code = source.slice(start, end).trim();
      components.push({ name: name!, code });
    },
  });

  // Deduplicate by name (keep first occurrence per file)
  const seen = new Set<string>();
  return components.filter((c) => {
    const k = c.name;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function main() {
  const scanRoot = path.resolve(
    process.env.SCAN_ROOT || path.join(process.cwd(), "..", "react-router")
  );
  console.log(`Scanning: ${scanRoot}`);

  const patterns = [
    "**/*.tsx",
    "**/*.ts",
    "**/*.jsx",
    "**/*.js",
    "!**/node_modules/**",
    "!**/dist/**",
    "!**/build/**",
    "!**/.next/**",
    "!**/coverage/**",
  ];

  const files = await fg(patterns, { cwd: scanRoot, dot: false, absolute: true });
  const all: ComponentInfo[] = [];

  for (const abs of files) {
    const rel = path.relative(scanRoot, abs);
    const code = readFileSafe(abs);
    if (!code) continue;

    const comps = extractComponents(abs, code);
    if (comps.length === 0) continue;

    for (const c of comps) {
      const trimmed = c.code.split("\n").slice(0, 200).join("\n"); // cap snippet
      try {
        const vec = await embed(`${c.name}\n\n${trimmed}`);
        all.push({
          name: c.name,
          file: rel,
          code: trimmed,
          embedding: vec,
        });
      } catch (e: any) {
        console.warn(`Embedding failed for ${rel}:${c.name} - ${e?.message || e}`);
      }
    }
  }

  all.sort((a, b) => a.name.localeCompare(b.name));

  fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
  const outPath = path.join(process.cwd(), "data", "index.json");
  fs.writeFileSync(outPath, JSON.stringify(all, null, 2));
  console.log(`Parsed ${files.length} files → ${all.length} components`);
  console.log(`Wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

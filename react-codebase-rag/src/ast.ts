import * as fs from "fs";
import * as path from "path";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import type { File } from "@babel/types";
import { ComponentInfo } from "./types";

const PARSER_OPTS = {
  sourceType: "module" as const,
  plugins: ["jsx", "typescript", "classProperties", "decorators-legacy"] as any
};

export function parseFile(filePath: string): File | null {
  try {
    const code = fs.readFileSync(filePath, "utf8");
    return parse(code, PARSER_OPTS);
  } catch {
    return null;
  }
}

export function extractComponents(filePath: string): ComponentInfo[] {
  const ast = parseFile(filePath);
  if (!ast) return [];
  const code = fs.readFileSync(filePath, "utf8");

  const comps: ComponentInfo[] = [];
  const imports = new Set<string>();
  const exports = new Set<string>();

  // Collect file-level imports/exports
  traverse(ast, {
    ImportDeclaration(p) {
      imports.add(p.node.source.value);
    },
    ExportNamedDeclaration(p) {
      if (p.node.declaration && "declarations" in p.node.declaration) {
        for (const d of p.node.declaration.declarations ?? []) {
          if (d.id && "name" in d.id) exports.add((d.id as any).name);
        }
      }
      for (const s of p.node.specifiers ?? []) {
        if ("exported" in s && "name" in s.exported) exports.add((s.exported as any).name);
      }
    },
    ExportDefaultDeclaration() {
      exports.add("default");
    }
  });

  const record = (
    name: string,
    kind: ComponentInfo["kind"],
    meta: Partial<ComponentInfo>
  ) => {
    const base: ComponentInfo = {
      id: `${filePath}#${name}`,
      filePath,
      name,
      kind,
      props: [],
      hooks: [],
      imports: Array.from(imports),
      exports: Array.from(exports),
      uses: [],
      hasErrorBoundary: false,
      patterns: [],
      summary: "",
      codeSnippet: code.slice(0, 1200)
    };
    const c = { ...base, ...meta } as ComponentInfo;
    c.summary = makeSummary(c);
    return c;
  };

  const collectJSXTags = (scopePath: any) => {
    const tags = new Set<string>();
    scopePath.traverse({
      JSXOpeningElement(pp: any) {
        const n = pp.node.name;
        if (n && (n as any).name) tags.add((n as any).name);
      }
    });
    return Array.from(tags);
  };

  function collectHooks(p: any): string[] {
    const hooks = new Set<string>();
    p.traverse({
      CallExpression(pp: any) {
        const callee = pp.node.callee as any;
        if (callee && callee.name && /^use[A-Z]/.test(callee.name)) hooks.add(callee.name);
      }
    });
    return Array.from(hooks);
  }

  function collectPropsFromParams(p: any): string[] {
    // For function components: (props) or ({a,b}: Props)
    const names = new Set<string>();
    const fn = "params" in p.node ? p.node : p.node;
    const params = (fn as any).params ?? [];
    for (const param of params) {
      if (param.type === "Identifier") names.add(param.name);
      if (param.type === "ObjectPattern") {
        for (const prop of (param.properties ?? [])) {
          if (prop.type === "ObjectProperty" && "name" in prop.key) {
            names.add((prop.key as any).name);
          }
        }
      }
    }
    return Array.from(names);
  }

  function inferPatterns(hooks: string[], uses: string[], p: any): string[] {
    const pats: string[] = [];
    if (hooks.includes("useEffect")) {
      // crude cleanup detection: return () => ...
      let hasCleanup = false;
      p.traverse({
        ReturnStatement(rr: any) {
          if (rr.findParent((x: any) => x.isArrowFunctionExpression() || x.isFunctionExpression())) {
            hasCleanup = true;
          }
        }
      });
      if (hasCleanup) pats.push("cleanup-effect");
    }
    if (uses.some(t => /Spinner|Skeleton|Loader|Progress|CircularProgress/i.test(t))) {
      pats.push("loading-state");
    }
    if (uses.some(t => /Error|Alert|Snackbar/i.test(t))) {
      pats.push("error-state");
    }
    // data fetching (fetch / axios.*)
    p.traverse({
      CallExpression(pp: any) {
        const callee = pp.node.callee as any;
        if (callee?.name === "fetch" || (callee?.object && callee.object.name === "axios")) {
          pats.push("data-fetching");
        }
      }
    });
    return Array.from(new Set(pats));
  }

  // Function components
  traverse(ast, {
    FunctionDeclaration(p) {
      const name = p.node.id?.name;
      if (!name || !/^[A-Z]/.test(name)) return;
      const uses = collectJSXTags(p);
      const hooks = collectHooks(p);
      const props = collectPropsFromParams(p);
      const patterns = inferPatterns(hooks, uses, p);
      comps.push(record(name, "function", { uses, hooks, props, patterns }));
    },
    // Arrow function components: const Foo = (..) => { ... }
    VariableDeclarator(p) {
      const id: any = p.node.id;
      const init: any = p.node.init;
      const name = id?.name;
      if (!name || !/^[A-Z]/.test(name)) return;
      if (!(init && init.type === "ArrowFunctionExpression")) return;
      const uses = collectJSXTags(p);
      const hooks = collectHooks(p);
      const props = collectPropsFromParams({ node: init } as any);
      const patterns = inferPatterns(hooks, uses, p);
      comps.push(record(name, "arrow", { uses, hooks, props, patterns }));
    },
    // Class components
    ClassDeclaration(p) {
      const name = p.node.id?.name;
      if (!name || !/^[A-Z]/.test(name)) return;
      let hasEB = false;
      p.traverse({
        ClassMethod(pp) {
          if ((pp.node.key as any)?.name === "componentDidCatch") hasEB = true;
        }
      });
      const uses = collectJSXTags(p);
      comps.push(record(name, "class", { hasErrorBoundary: hasEB, uses, hooks: [] }));
    }
  });

  return comps;
}

function makeSummary(c: ComponentInfo): string {
  return [
    `${c.name} (${c.kind}) in ${path.basename(c.filePath)}`,
    c.props.length ? `props: ${c.props.join(", ")}` : "",
    c.hooks.length ? `hooks: ${c.hooks.join(", ")}` : "",
    c.uses.length ? `uses: ${c.uses.slice(0, 10).join(", ")}` : "",
    c.patterns.length ? `patterns: ${c.patterns.join(", ")}` : "",
    c.hasErrorBoundary ? "error boundary" : ""
  ].filter(Boolean).join(" | ");
}

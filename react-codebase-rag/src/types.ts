export type ComponentInfo = {
    id: string;
    filePath: string;
    name: string;
    kind: "function" | "arrow" | "class" | "unknown";
    props: string[];
    hooks: string[];
    imports: string[];
    exports: string[];
    uses: string[];
    hasErrorBoundary: boolean;
    patterns: string[];
    summary: string;
    codeSnippet: string;
    embedding?: number[];
  };
  
  export type IndexFile = {
    createdAt: string;
    components: ComponentInfo[];
    dim: number;
  };
  
import fg from "fast-glob";

/**
 * Recursively find React/TS source files under `root`.
 * Skips common build dirs to avoid noise and huge indexes.
 */
export async function findSourceFiles(root: string): Promise<string[]> {
  const files = await fg(["**/*.{tsx,jsx,ts,js}"], {
    cwd: root,
    ignore: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/.storybook-out/**"
    ]
  });
  return files.map(f => `${root}/${f}`);
}

// Test helper: the RUNTIME import graph of an app module (no `import type`),
// resolved through the "@/" alias and relative paths. Packages are left out.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

export function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Runtime import statements: the specifier and the names imported (null = a namespace / side-effect / dynamic import). */
export function runtimeImportStatements(src: string): { spec: string; names: string[] | null }[] {
  const out: { spec: string; names: string[] | null }[] = [];
  for (const m of src.matchAll(/^\s*(import|export)\s+(type\s+)?([^;]*?)\s*from\s+["']([^"']+)["'];?/gm)) {
    if (m[2]) continue;
    const clause = m[3]!;
    const braces = clause.match(/\{([^}]*)\}/);
    const names = braces
      ? braces[1]!.split(",").map((s) => s.trim()).filter((s) => s && !s.startsWith("type ")).map((s) => s.split(/\s+as\s+/)[0]!.trim())
      : null;
    out.push({ spec: m[4]!, names });
  }
  for (const m of src.matchAll(/^\s*import\s+["']([^"']+)["'];?/gm)) out.push({ spec: m[1]!, names: null });
  for (const m of src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push({ spec: m[1]!, names: null });
  return out;
}

export function importGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const { spec } of runtimeImportStatements(readFileSync(f, "utf8"))) {
      const r = resolveImport(f, spec);
      if (r && !seen.has(r)) stack.push(r);
    }
  }
  return seen;
}

export const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");

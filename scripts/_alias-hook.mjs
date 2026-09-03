// =============================================================================
// scripts/_alias-hook.mjs — teach `node` the "@/" path alias.
//
// Library modules import each other with the app's "@/..." alias (tsconfig
// paths). Next resolves that; bare `node` does not, so any seed script that
// pulls in a lib module fails with ERR_MODULE_NOT_FOUND on "@/lib/...".
//
// Rather than rewriting library files to relative paths just to suit the
// scripts — which would leave the codebase with two conventions — this hook
// maps "@/x" to "<repo root>/x" and appends the .ts extension node needs for
// extensionless relative specifiers.
//
// Usage:  node --import ./scripts/_alias-hook.mjs scripts/<script>.ts
// =============================================================================

import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Add .ts / .tsx / index.ts when the specifier has no usable extension. */
function withExtension(filePath) {
  if (existsSync(filePath) && !filePath.endsWith(path.sep)) return filePath;
  for (const ext of [".ts", ".tsx", ".js", ".mjs"]) {
    if (existsSync(filePath + ext)) return filePath + ext;
  }
  for (const ext of [".ts", ".tsx"]) {
    const idx = path.join(filePath, `index${ext}`);
    if (existsSync(idx)) return idx;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // "@/lib/foo" → "<root>/lib/foo.ts"
    if (specifier.startsWith("@/")) {
      const resolved = withExtension(path.join(ROOT, specifier.slice(2)));
      if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }
    // Relative specifiers that omit the .ts extension.
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const base = path.dirname(fileURLToPath(context.parentURL));
      const resolved = withExtension(path.resolve(base, specifier));
      if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

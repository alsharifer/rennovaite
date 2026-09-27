import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// =============================================================================
// The Atelier spacing scale (tailwind.config.ts → theme.extend.spacing) defines
// named steps — xs, sm, md, lg, xl, 2xl, gutter, margin — and Tailwind v4's
// `max-w-*` / `min-w-*` / `w-*` utilities resolve a named key against the
// SPACING scale before the container scale. So `max-w-xl` is 48 px and
// `max-w-2xl` is 64 px, not 36 / 42 rem: a paragraph carrying either wrapped one
// word per line (found on /firms, /firms/:id, the sign-in card, the revisions
// page and the approvals panel). A width that means "a reading measure" must be
// written explicitly (`max-w-[672px]`) or use a key the spacing scale does not
// shadow (`max-w-4xl`).
// =============================================================================

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

const config = readFileSync(path.join(ROOT, "tailwind.config.ts"), "utf8");
const spacingBlock = /spacing:\s*\{([\s\S]*?)\n\s*\}/.exec(config)?.[1] ?? "";
const SHADOWED = [...spacingBlock.matchAll(/^\s*"?([a-z0-9]+)"?:/gm)].map((m) => m[1]!);

describe("max-width classes never use a key the spacing scale shadows", () => {
  it("reads the spacing keys from tailwind.config.ts", () => {
    expect(SHADOWED).toEqual(expect.arrayContaining(["xl", "2xl"]));
  });

  it("no .tsx under app/ or components/ uses max-w-<spacing key>", () => {
    const re = new RegExp(`\\bmax-w-(${SHADOWED.join("|")})\\b`);
    const hits = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components"))]
      .filter((f) => re.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f).split(path.sep).join("/"));
    expect(hits).toEqual([]);
  });
});

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import subset from "../subset.json";

// K10 #6 — Material Symbols Sharp is self-hosted as a subset of the icons the
// app draws; its ligature text is never visible; Inter and Rubik are gone.
const ROOT = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const SKIP = [/^components\/marketing\//, /^app\/_components\//, /__tests__\//, /\.test\.tsx?$/];

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${n}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(tsx?)$/.test(n)) out.push(rel);
  }
  return out;
}

/** Every icon name the routed code can hand to <Icon>, an icon prop, an *_ICON table or an Atelier icon span. */
function iconNames(): Map<string, string> {
  const found = new Map<string, string>();
  const add = (name: string, f: string) => found.set(name, f);
  for (const f of ["app", "components", "lib"].flatMap((d) => walk(d)).filter((f) => !SKIP.some((re) => re.test(f)))) {
    const src = read(f);
    for (const m of src.matchAll(/<Icon\b[^>]*?\bname="([a-z0-9_]+)"/g)) add(m[1]!, f);
    // name={cond ? "a" : "b"}: the RESULTS of the ternary (after ? or :), not the operands it compares.
    for (const m of src.matchAll(/<Icon\b[^>]*?\bname=\{([^}]*)\}/g)) for (const q of m[1]!.matchAll(/(?:^|[?:]\s*)"([a-z0-9_]+)"/g)) add(q[1]!, f);
    for (const m of src.matchAll(/\bicon(?:=|:\s*|=\{)"([a-z0-9_]+)"/g)) add(m[1]!, f);
    // A lookup table (STAGE_ICON, KIND_ICON …): its values, one brace level — a nested { icon: … } is the rule above.
    for (const m of src.matchAll(/[A-Z_]*ICON[A-Z_]*\b[^=\n]*=\s*\{([^{}]*)\}/g)) for (const q of m[1]!.matchAll(/:\s*"([a-z0-9_]+)"/g)) add(q[1]!, f);
    for (const m of src.matchAll(/material-symbols-outlined[^>]*>\s*([a-z0-9_]+)\s*</g)) add(m[1]!, f);
  }
  return found;
}

describe("the self-hosted icon subset", () => {
  it("holds every icon the routed code draws", () => {
    const names = new Set(subset.names);
    const used = iconNames();
    expect(used.size).toBeGreaterThan(60);
    const missing = [...used].filter(([n]) => !names.has(n)).map(([n, f]) => `${n} (${f})`);
    expect(missing, "regenerate: node scripts/k10-icon-subset.mjs <codepoints>").toEqual([]);
  });

  it("is the requested cut: weight 300–400, FILL 0, GRAD 0, optical size 20–24", () => {
    expect(subset.axes).toBe("opsz,wght,FILL,GRAD@20..24,300..400,0,0");
    expect(subset.count).toBe(subset.names.length);
  });

  it("is the file SOURCES.json records, a woff2", () => {
    const bytes = readFileSync(path.join(ROOT, "public/fonts/material-symbols-sharp.woff2"));
    const src = JSON.parse(read("public/fonts/SOURCES.json"))["material-symbols-sharp.woff2"];
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("wOF2");
    expect(bytes.length).toBe(src.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(src.sha256);
    expect(bytes.length).toBeLessThan(200 * 1024);
  });

  it("is preloaded and never fetched from Google at runtime", () => {
    const layout = read("app/layout.tsx");
    expect(layout).not.toContain("fonts.googleapis.com");
    expect(layout).toContain('<link rel="preload" href="/fonts/material-symbols-sharp.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />');
    expect(layout).toContain("ICONS_READY_SCRIPT");
  });

  it("no ligature text is ever visible: font-display block, a 1em clipped box, transparent until the font is in", () => {
    const css = read("app/globals.css");
    const face = /@font-face \{[^}]*"Material Symbols Sharp"[^}]*\}/.exec(css)?.[0] ?? "";
    expect(face).toContain('url("/fonts/material-symbols-sharp.woff2")');
    expect(face).toContain("font-display: block");
    expect(css).toMatch(/html:not\(\[data-icons="ready"\]\) \.bp-icon,\s*html:not\(\[data-icons="ready"\]\) \.material-symbols-outlined \{\s*color: transparent !important;/);
    for (const cls of [".material-symbols-outlined {", ".bp-icon {"]) {
      // The class's own rule (on a line of its own), not the html:not(…) hide rule that names it too.
      const at = css.split(/\r?\n/).findIndex((l) => l.trim() === cls);
      const lines = css.split(/\r?\n/);
      const block = lines.slice(at, at + lines.slice(at).findIndex((l) => l.trim() === "}")).join("\n");
      expect(block, cls).toContain("width: 1em;");
      expect(block, cls).toContain("overflow: hidden;");
    }
    const script = read("lib/icons/ready.ts");
    expect(script).toContain('setAttribute("data-icons","ready")');
    // Ready only when a face actually loaded — a failed load keeps the names hidden.
    expect(script).toContain("if(l&&l.length)ready()");
  });

  it("Inter and Rubik are gone (nothing routed used them)", () => {
    const layout = read("app/layout.tsx");
    expect(layout).not.toMatch(/inter-latin|rubik-arabic|--font-inter|--font-rubik/);
    for (const f of ["app/globals.css", "tailwind.config.ts", "app/project/[id]/plan/_components/editable-plan-viewer.tsx"]) expect(read(f), f).not.toMatch(/--font-inter|--font-rubik/);
  });
});

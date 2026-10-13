#!/usr/bin/env node
// =============================================================================
// scripts/k10-icon-subset.mjs — build the self-hosted Material Symbols Sharp
// subset (K10 #6): only the icons the app can draw, weight 300–400, FILL 0,
// GRAD 0, optical size 20–24.
//
//   node scripts/k10-icon-subset.mjs <codepoints-file>
//
// <codepoints-file> is Google's official name list for the Sharp variable font
// (material-design-icons/variablefont/MaterialSymbolsSharp[…].codepoints).
// The names kept are every quoted lowercase token in ROUTED source (app/,
// components/ except the parked marketing, lib/) that is a Material Symbols
// name — a deliberate superset: an icon picked by a ternary or a lookup table
// is a string literal somewhere, so nothing drawable is left out (a word that
// merely happens to be an icon name costs a few hundred bytes). Writes:
//   lib/icons/subset.json                 the names + the axes requested
//   public/fonts/material-symbols-sharp.woff2
//   public/fonts/SOURCES.json             url, bytes, sha256
// lib/icons/__tests__/subset.test.ts holds the app to it.
// =============================================================================

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const cpFile = process.argv[2];
if (!cpFile || !fs.existsSync(cpFile)) throw new Error("usage: node scripts/k10-icon-subset.mjs <codepoints-file>");
const known = new Set(fs.readFileSync(cpFile, "utf8").split(/\r?\n/).map((l) => l.split(" ")[0]).filter(Boolean));

export const SKIP = [/^components\/marketing\//, /^app\/_components\//, /__tests__\//, /\.test\.tsx?$/];
function walk(dir, out = []) {
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, n.name);
    if (n.isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs)$/.test(n.name)) out.push(path.relative(ROOT, p).split(path.sep).join("/"));
  }
  return out;
}
const files = ["app", "components", "lib"].flatMap((d) => walk(path.join(ROOT, d))).filter((f) => !SKIP.some((re) => re.test(f)));
const used = new Set();
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  for (const m of src.matchAll(/["'`]([a-z0-9_]{2,40})["'`]/g)) if (known.has(m[1])) used.add(m[1]);
  // Atelier-era spans write the name as text: <span className="material-symbols-outlined">name</span>
  for (const m of src.matchAll(/material-symbols-outlined[^>]*>\s*([a-z0-9_]+)\s*</g)) if (known.has(m[1])) used.add(m[1]);
}
const names = [...used].sort();
const AXES = "opsz,wght,FILL,GRAD@20..24,300..400,0,0";
const cssUrl = `https://fonts.googleapis.com/css2?family=Material+Symbols+Sharp:${AXES}&icon_names=${names.join(",")}&display=block`;
const css = await (await fetch(cssUrl, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" } })).text();
const fontUrl = /url\((https:[^)]+)\)\s*format\(['"]woff2['"]\)/.exec(css)?.[1];
if (!fontUrl) throw new Error(`no woff2 in the stylesheet:\n${css.slice(0, 400)}`);
const bytes = new Uint8Array(await (await fetch(fontUrl)).arrayBuffer());
if (!(bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x32)) throw new Error("not a woff2 file");
fs.mkdirSync(path.join(ROOT, "public/fonts"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "public/fonts/material-symbols-sharp.woff2"), bytes);
fs.mkdirSync(path.join(ROOT, "lib/icons"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "lib/icons/subset.json"), JSON.stringify({ family: "Material Symbols Sharp", axes: AXES, count: names.length, names }, null, 2) + "\n");
fs.writeFileSync(
  path.join(ROOT, "public/fonts/SOURCES.json"),
  JSON.stringify({ "material-symbols-sharp.woff2": { stylesheet: cssUrl.replace(/icon_names=[^&]+/, `icon_names=<${names.length} names, lib/icons/subset.json>`), url: fontUrl, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), license: "Apache-2.0 (Material Symbols)" } }, null, 2) + "\n",
);
console.log(`${names.length} icons · ${(bytes.length / 1024).toFixed(1)} KiB → public/fonts/material-symbols-sharp.woff2`);

// =============================================================================
// scripts/kv-atelier-unchanged.mjs — the Atelier pages did not move (KV).
//
//   node scripts/kv-atelier-unchanged.mjs <base-port> <head-port> <project-id> [--shots=dir]
//
// The pages the K-series leaves Atelier this cycle (CLAUDE.md "Two design
// systems": 03 Specification /accessories, owner Ideation · Moodboard · Style ·
// Render · Scope & timeline · Vendors · Viewer, and /rennovaite) are
// photographed on two servers — the pre-K4 commit (base) and this branch
// (head) — over the same database, at the same viewport, and compared pixel by
// pixel with sharp. A page passes when ≤ 0.5% of its pixels differ (anti-
// aliasing, a clock). Prints the share per page; writes both shots and a diff
// mask when --shots is given. READ-ONLY.
// =============================================================================

import fs from "node:fs";

import sharp from "sharp";

import { openBrowser } from "./lib/cdp.mjs";

const [basePort, headPort, id] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const SHOTS = process.argv.find((a) => a.startsWith("--shots="))?.slice(8);
if (!id) throw new Error("usage: kv-atelier-unchanged.mjs <base-port> <head-port> <project-id> [--shots=dir]");
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const PAGES = [
  ["specification", `/project/${id}/accessories`],
  ["design", `/project/${id}/design`],
  ["references", `/project/${id}/design?view=references`],
  ["render", `/project/${id}/render`],
  ["scope-timeline", `/project/${id}/timeline`],
  ["vendors", `/project/${id}/vendors`],
  ["viewer", `/project/${id}/viewer`],
  ["rennovaite", `/rennovaite`],
];
const TOLERANCE = 0.005;

async function shoot(b, port, path, file) {
  await b.goto(`http://localhost:${port}${path}`, "body");
  await new Promise((r) => setTimeout(r, 4000));
  await b.evaluate("window.scrollTo(0, 0)");
  await b.screenshot(file);
}

const tmp = SHOTS ?? fs.mkdtempSync("kv-atelier-");
const b = await openBrowser({ script: "kv-atelier-unchanged", projects: [id] });
let failures = 0;
try {
  await b.viewport(1440, 1000);
  for (const [name, path] of PAGES) {
    const fa = `${tmp}/${name}-base.png`;
    const fb = `${tmp}/${name}-head.png`;
    await shoot(b, basePort, path, fa);
    await shoot(b, headPort, path, fb);
    const [A, B] = await Promise.all([sharp(fa).raw().toBuffer({ resolveWithObject: true }), sharp(fb).raw().toBuffer({ resolveWithObject: true })]);
    if (A.info.width !== B.info.width || A.info.height !== B.info.height) {
      failures++;
      console.log(`  FAIL  ${name}  size ${A.info.width}×${A.info.height} vs ${B.info.width}×${B.info.height}`);
      continue;
    }
    const ch = A.info.channels;
    const n = A.info.width * A.info.height;
    const mask = Buffer.alloc(n);
    let diff = 0;
    for (let i = 0; i < n; i++) {
      let d = 0;
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(A.data[i * ch + c] - B.data[i * ch + c]));
      if (d > 16) {
        diff++;
        mask[i] = 255;
      }
    }
    const share = diff / n;
    if (SHOTS) await sharp(mask, { raw: { width: A.info.width, height: A.info.height, channels: 1 } }).png().toFile(`${SHOTS}/${name}-diff.png`);
    const ok = share <= TOLERANCE;
    if (!ok) failures++;
    console.log(`${ok ? "  ok " : "  FAIL"}  ${name.padEnd(16)} ${(share * 100).toFixed(2)}% of pixels differ`);
  }
} finally {
  await b.close();
}
console.log(failures ? `\n${failures} ATELIER PAGE(S) MOVED` : "\nATELIER PAGES UNCHANGED");
process.exit(failures ? 1 : 0);

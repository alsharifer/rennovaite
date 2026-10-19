// =============================================================================
// scripts/b6-room-pack-check.ts — bathroom pilot B6: the room's client pack,
// read through a verification job (nothing released), checked, and every page
// rendered to PNG for review.
//
//   node --env-file=.env.local --experimental-transform-types --import ./scripts/_alias-hook.mjs \
//     scripts/b6-room-pack-check.ts [port] [project-id]
//
// Default project: the dev test bathroom a2661f34. Checks: page order (cover,
// the room with its photos, a page per view, the drawings, materials, BoQ,
// price, programme); the total = the latest BoQ to the fil; every drawing
// dimension = the plan graph to the mm (walls, ceiling, openings); the door's
// hinge as stored; no missing image; no withheld identity. Output (gitignored —
// the client's room): screenshots/bathroom-pilot/b6/pack/.
// =============================================================================

import { mkdirSync, writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import { Resvg } from "@resvg/resvg-js";

import { resolveTarget } from "./_target-guard.mjs";
import { devFetch } from "./lib/dev-auth.mjs";
import { verificationJobs } from "./lib/verification-job.mjs";

import { documentFontOptions } from "../lib/documents/doc-fonts.ts";
import { roomWalls } from "../lib/drawings/room-sheets.ts";
import { findWithheldIdentities, loadWithheldNames } from "../lib/identity/curation.ts";
import { derivePlanGraph } from "../lib/plan/derive.ts";

const SCRIPT = "b6-room-pack-check";
const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3096";
const P = process.argv.find((a) => /^[0-9a-f-]{36}$/.test(a)) ?? "a2661f34-9d96-4020-a755-40359440c302";
const BASE = `http://localhost:${PORT}`;
const OUT = "screenshots/bathroom-pilot/b6/pack";
mkdirSync(OUT, { recursive: true });
const { url, key } = resolveTarget({ script: SCRIPT, writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const app = devFetch("b1-owner", { script: SCRIPT });
const vj = verificationJobs(sb, SCRIPT);
try {
  const h = { ...(await vj.headers(P)), authorization: await app.authorization() };
  const res = await fetch(`${BASE}/api/projects/${P}/room-pack?format=pages`, { headers: h });
  const body = (await res.json().catch(() => null)) as { pages?: string[]; images?: { src: string; x: number; y: number; w: number; h: number }[][]; summary?: { pages: { kind: string; title: string; images: number }[]; views: { label: string; render: string | null; locked: boolean; anchor: boolean }[]; sheets: string[]; missing_images: string[]; grand_total_aed: number; boq_id: string }; error?: string } | null;
  check("the room pack answers a verification job", res.ok && !!body?.pages?.length, `${res.status} ${body?.error ?? ""}`);
  if (!body?.pages || !body.summary) throw new Error("no pack");
  const { pages, summary } = body;
  const kinds = summary.pages.map((p) => p.kind);
  console.log("  ·  pages:", summary.pages.map((p) => `${p.kind}${p.images ? `(${p.images} img)` : ""}`).join(" · "));
  const order = ["cover", "room_plan", "view", "drawing", "materials", "boq", "price", "programme"];
  const firstIdx = order.map((k) => kinds.indexOf(k));
  check("the order: cover → room + photos → views → drawings → materials → BoQ → price → programme", firstIdx.every((i) => i >= 0) && firstIdx.every((v, i, a) => i === 0 || v > a[i - 1]!), JSON.stringify(firstIdx));
  // B7 1a: a view shows a render that matches the current design, or a labelled placeholder — never a stale render.
  const pendingN = pages.join("").split("data-view-pending=").length - 1;
  check(`one page per photo view: a matching render or a labelled placeholder (${pendingN} pending)`, summary.pages.filter((p) => p.kind === "view").length === summary.views.length && summary.views.filter((v) => !v.render).length === pendingN, summary.views.map((v) => `${v.label.split(" · ")[0]}${v.anchor ? " (anchor)" : v.locked ? " (locked)" : ""}`).join(", "));
  check("the drawings: the plan + one elevation per wall, in the room series (R-)", summary.sheets.length === 5 && summary.sheets.every((s) => s.startsWith("R-")), summary.sheets.join(" · "));
  check("no missing image", summary.missing_images.length === 0, summary.missing_images.join(", "));

  // The total = the latest BoQ, to the fil.
  const { data: boq } = await sb.from("boqs").select("id, total_aed").eq("project_id", P).order("created_at", { ascending: false }).limit(1).single();
  const joined = pages.join("");
  check(`the total is the latest BoQ's to the fil — AED ${boq!.total_aed}`, summary.boq_id === boq!.id && (joined.match(new RegExp(`data-grand-total="${Number(boq!.total_aed)}"`, "g")) ?? []).length >= 2);
  check("the options are priced in it", /data-option="wall_hung_wc"/.test(joined) && /data-option="bulkhead_removal"/.test(joined));

  // Every drawing dimension against the graph, to the mm.
  const graph = await derivePlanGraph(P);
  const room = graph.rooms.find((r) => r.in_scope !== false)!;
  const walls = roomWalls(room);
  const drawingPages = pages.filter((_, i) => summary.pages[i]!.kind === "drawing");
  const dims = drawingPages.flatMap((svg) => [...svg.matchAll(/data-dim="([^"]+)" data-mm="(-?\d+)" data-src="([^"]+)"/g)].map((m) => ({ key: m[1]!, mm: Number(m[2]), src: m[3]! })));
  const wallDims = dims.filter((d) => d.key.startsWith("wall:"));
  const wallBad = wallDims.filter((d) => d.mm !== Math.round(walls.find((w) => `wall:${w.side}` === d.key)!.length_m * 1000));
  check(`every wall length printed = the graph (${wallDims.length} dims)`, wallDims.length >= 4 && wallBad.length === 0, wallBad.map((d) => `${d.key} ${d.mm}`).join(", "));
  const ceil = dims.filter((d) => d.key === "ceiling");
  check(`the ceiling printed = the graph (${Math.round(room.ceiling_h_m * 1000)} mm, ${ceil.length} elevations)`, ceil.length === 4 && ceil.every((d) => d.mm === Math.round(room.ceiling_h_m * 1000)));
  const opBad: string[] = [];
  for (const o of graph.openings) {
    for (const f of ["width_mm", "height_mm", "sill_mm"] as const) {
      for (const d of dims.filter((x) => x.src === `${o.id}.${f}`)) if (d.mm !== Math.round(o[f])) opBad.push(`${o.type} ${f} ${d.mm} vs ${o[f]}`);
    }
  }
  const opCount = dims.filter((d) => graph.openings.some((o) => d.src.startsWith(`${o.id}.`))).length;
  check(`every opening dimension printed = the graph (${opCount} dims)`, opCount >= 4 && opBad.length === 0, opBad.join("; "));
  const chains = new Map<string, number>();
  for (const d of dims.filter((x) => /^(North|South|East|West):/.test(x.src) && !x.key.startsWith("wall:"))) chains.set(d.src.split(":")[0]!, (chains.get(d.src.split(":")[0]!) ?? 0) + d.mm);
  const chainBad = [...chains].filter(([side, sum]) => sum !== Math.round(walls.find((w) => w.side === side)!.length_m * 1000));
  check("every wall's dimension chain closes on its length", chainBad.length === 0, [...chains].map(([s, v]) => `${s} ${v}`).join(", "));
  const tileBad = walls.filter((w) => {
    const chain = dims.filter((d) => d.key === `cut-left:${w.side}` || d.key.startsWith(`tile:${w.side}:`) || d.key === `cut-right:${w.side}`);
    return chain.reduce((a, d) => a + d.mm, 0) !== Math.round(w.length_m * 1000);
  });
  check("every elevation's tile setting-out closes on its wall", tileBad.length === 0, tileBad.map((w) => w.side).join(", "));
  const door = graph.openings.find((o) => o.type === "door");
  // B7: the side entered on 01 Plan (left/right from the room) wins; else the B6 compass letter; else an estimate.
  const hinge = door ? String(door.spec?.hinge_side ?? door.spec?.hinge ?? "estimate") : "";
  if (door) check(`the door swings from its stored hinge (${hinge})`, hinge === "estimate" ? /data-hinge="estimate-/.test(joined) : joined.includes(`data-hinge="${hinge}"`));

  // No withheld identity on any page.
  const withheld = await loadWithheldNames(sb as never, P);
  const leaks = findWithheldIdentities(pages.map((p) => p.replace(/<[^>]+>/g, " ")), withheld);
  check("no withheld identity on any page", leaks.length === 0, leaks.join(", "));

  // The PDF, and every page as a PNG for review.
  const pdfRes = await fetch(`${BASE}/api/projects/${P}/room-pack`, { headers: h, redirect: "follow" });
  if (pdfRes.ok) writeFileSync(`${OUT}/room-pack.pdf`, Buffer.from(await pdfRes.arrayBuffer()));
  check("the PDF downloads", pdfRes.ok, `${pdfRes.status}`);
  // The review PNGs carry the photographs too (the PDF places them the same way: contained, centred).
  const dataUri = new Map<string, string>();
  for (const src of new Set((body.images ?? []).flat().map((s) => s.src))) {
    const r = await fetch(src);
    if (r.ok) dataUri.set(src, `data:${r.headers.get("content-type") ?? "image/jpeg"};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`);
  }
  pages.forEach((svg, i) => {
    const imgs = (body.images?.[i] ?? []).map((s) => (dataUri.has(s.src) ? `<image href="${dataUri.get(s.src)}" x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" preserveAspectRatio="xMidYMid meet"/>` : "")).join("");
    const withImages = imgs ? svg.replace(/<\/svg>\s*$/, `${imgs}</svg>`) : svg;
    writeFileSync(`${OUT}/p${String(i + 1).padStart(2, "0")}-${summary.pages[i]!.kind}.png`, new Resvg(withImages, { fitTo: { mode: "width", value: 1500 }, font: documentFontOptions() }).render().asPng());
  });
} finally {
  await vj.close();
}
console.log(failures === 0 ? "\nB6 ROOM PACK: ALL CHECKS PASSED" : `\nB6 ROOM PACK: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

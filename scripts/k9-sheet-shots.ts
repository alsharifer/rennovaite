// =============================================================================
// scripts/k9-sheet-shots.ts — PNGs of the garden drawing set (K9 #5: ink only)
// from the Villa 94 reference geometry. Pure: no database, no server.
//
//   node --experimental-transform-types --import ./scripts/_alias-hook.mjs scripts/k9-sheet-shots.ts [outDir]
//
// Two sets: as measured (only the lawn's area is derived — one hatched zone),
// and as a draft with every zone outline derived (all hatched, the inverse
// draft stamp on every sheet). Plus the draft render pack's chrome (no renders:
// every view slot is its stated placeholder).
// =============================================================================

import fs from "node:fs";
import path from "node:path";

import { Resvg } from "@resvg/resvg-js";

import { documentFontOptions } from "@/lib/documents/doc-fonts";
import { buildRenderPack } from "@/lib/documents/render-pack";
import { buildGardenSheets } from "@/lib/drawings/garden-sheets";
import { villa94PlanRecords } from "@/lib/ground-truth/villa94-garden-geometry";
import { buildPlanGraph } from "@/lib/plan/geometry";

const out = process.argv[2] ?? "screenshots/k9/ink-sheets";
fs.mkdirSync(out, { recursive: true });

function graphOf(draft: boolean) {
  const rec = villa94PlanRecords();
  const rooms = draft ? rec.rooms.map((r) => ({ ...r, dims_derived: true })) : rec.rooms;
  const graph = buildPlanGraph({ projectId: "p", planId: "pl", scale: null, total_area_m2: rooms.reduce((s, r) => s + r.area_m2, 0), rooms, elements: rec.elements, context: rec.context, unit_to_m: rec.plot.width_m, plot: rec.plot, source: "user_drawn" });
  return { rec, graph };
}

function set(draft: boolean) {
  const { rec, graph } = graphOf(draft);
  const meta = { projectNameEn: "Reference garden", projectNameAr: null, community: "Dubai", level: "ground", scale: "1:100", dateISO: "2026-10-13", preparedBy: "Scratch Landscapes & Co.", rev: "46", ...(draft ? { draft: "DRAFT FOR REVIEW — quantities derived from reference layout; firm after site verification." } : {}) };
  return buildGardenSheets(graph, rec.fixtures, meta);
}

for (const [tag, sheets] of [["measured", set(false)], ["draft", set(true)]] as const) {
  for (const s of sheets.filter((x) => /^L-(000|100|101|401|402)$/.test(x.sheetNumber))) {
    const png = new Resvg(s.svg, { fitTo: { mode: "width", value: 1754 }, font: documentFontOptions() }).render().asPng();
    fs.writeFileSync(path.join(out, `${tag}-${s.sheetNumber}.png`), png);
  }
}
{
  const { rec, graph } = graphOf(true);
  const sitePlanSvg = set(true).find((x) => x.sheetNumber === "L-100")!.svg;
  const { pages } = buildRenderPack({ graph, fixtures: rec.fixtures, renders: {}, style: null, projectName: "Reference garden", community: "Dubai", dateISO: "2026-10-13", sitePlanSvg, draft: "DRAFT FOR REVIEW — quantities derived from reference layout; firm after site verification.", draftNote: "reference layout" });
  pages.slice(0, 4).forEach((p, i) => fs.writeFileSync(path.join(out, `pack-${i + 1}-${p.kind}.png`), new Resvg(p.svg, { fitTo: { mode: "width", value: 1240 }, font: documentFontOptions() }).render().asPng()));
}
console.log(`sheets → ${out}`);

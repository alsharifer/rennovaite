// =============================================================================
// scripts/k8-doc-shots.ts — PNGs of the client documents for side-by-side review
// with their frames (K8 #15–17). Pure: built from the Arabella G5d fixture,
// nothing read from or written to a database, no server.
//
//   node --experimental-transform-types --import ./scripts/_alias-hook.mjs scripts/k8-doc-shots.ts [outDir]
//
// Writes proposal-<n>.png (setup: line rates off, a client, validity, payment
// terms, cover note), proposal-preview-1.png, and boq-<n>.png.
// =============================================================================

import { documentFontOptions } from "@/lib/documents/doc-fonts";
import fs from "node:fs";
import path from "node:path";

import { Resvg } from "@resvg/resvg-js";

import type { BoqPdfInput } from "@/lib/documents/boq-pdf";
import { buildBoqPdfPages } from "@/lib/documents/boq-pdf";
import { buildProposalPages } from "@/lib/documents/proposal";
import { renderSheet } from "@/lib/drawings/sheet";

const out = process.argv[2] ?? "screenshots/k8/docs";
fs.mkdirSync(out, { recursive: true });
const fx = JSON.parse(fs.readFileSync("lib/boq/__fixtures__/arabella-g5d-revisions.json", "utf8")) as { stages: { boq_id: string }[]; boqs: Record<string, BoqPdfInput["boq"]> };
const boq = fx.boqs[fx.stages[7]!.boq_id]!;

const png = (svg: string, file: string) => {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: svg.includes('width="297mm"') ? 1754 : 1240 }, font: documentFontOptions() });
  fs.writeFileSync(path.join(out, file), r.render().asPng());
};

const proposal = buildProposalPages({
  brand: "Scratch Landscapes & Co.",
  logoDataUri: null,
  termsText: "Works start within 14 days of the signed order.\n\nVariations are priced in writing before they are carried out.",
  projectName: "Garden — Draft for Review",
  community: "Dubai",
  dateISO: "2026-10-12",
  rooms: [{ name: "Rear lawn", kind: "artificial_grass", area_m2: 47.8 }, { name: "Entrance paving", kind: "paving", area_m2: 12.3 }],
  boq,
  revision: 46,
  clientLabel: "Private homeowner",
  validity: "Valid for 30 days from issue — until 11 November 2026",
  paymentTerms: "40% on order, 50% on completion of hardscape, 10% on handover.",
  coverNote: "Thank you for the opportunity to price your garden. This proposal follows the design we walked through on site.",
  showLineRates: false,
});
proposal.forEach((p, i) => png(p, `proposal-${i + 1}.png`));
png(buildProposalPages({ brand: "Scratch Landscapes & Co.", logoDataUri: null, termsText: null, projectName: "Garden — Draft for Review", community: "Dubai", dateISO: "2026-10-12", rooms: [], boq, preview: true, showLineRates: false })[0]!, "proposal-preview-1.png");

const boqPages = buildBoqPdfPages({ projectName: "Garden — Draft for Review", community: "Dubai", dateISO: "2026-10-12", boq, revision: 46 });
boqPages.forEach((p, i) => png(p, `boq-${i + 1}.png`));
// A sheet frame (68:1542): two rooms stand in for the drawing — the title block, status strip, north and scale are the point.
const room = (x: number, y: number, w: number, h: number, name: string) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#1A1D1F" stroke-width="0.7"/><text x="${x + 3}" y="${y + 6}" font-size="3" fill="#1A1D1F" style="font-family:Consolas">${name}</text>`;
const sheet = (draft: string | null) =>
  renderSheet({
    meta: { projectNameEn: "Garden — Draft for Review", community: "Dubai", level: "ground", scale: "1:50", dateISO: "2026-10-12", preparedBy: "Scratch Landscapes & Co.", draft },
    sheetNumber: "L-100",
    title: "Site plan",
    body: room(40, 30, 110, 80, "REAR LAWN 47.8 m²") + room(150, 30, 70, 80, "PERGOLA 12.3 m²"),
  });
fs.writeFileSync(path.join(out, "sheet.svg"), sheet(null));
const r2 = (svg: string, file: string) => fs.writeFileSync(path.join(out, file), new Resvg(svg, { fitTo: { mode: "width", value: 1754 }, font: documentFontOptions() }).render().asPng());
r2(sheet(null), "sheet-L-100.png");
r2(sheet("DRAFT FOR REVIEW — quantities derived from reference layout; firm after site verification."), "sheet-L-100-draft.png");
console.log(`${proposal.length} proposal pages, ${boqPages.length} BoQ pages → ${out}`);

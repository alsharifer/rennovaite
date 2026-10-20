// C4 — ONE schedule engine: the quantity-derived programme (programmeOf),
// generalised from the bathroom pilot (B7 1c). One number per project on every
// surface; the villa week model and the value-scaled garden programme retired.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT } from "@/lib/__tests__/helpers/import-graph";
import arabella from "@/lib/boq/__fixtures__/arabella-g5d-revisions.json";
import jumeirah from "@/lib/boq/__fixtures__/c1-jumeirah-rev1.json";
import mudon from "@/lib/boq/__fixtures__/c1-mudon-latest.json";
import { buildReviewModel } from "@/lib/boq/review-model";
import { buildBoqPdfPages } from "@/lib/documents/boq-pdf-pages";
import { buildProposalPages } from "@/lib/documents/proposal";
import { MUDON_PROGRAMME_DAYS } from "@/lib/ground-truth/mudon-phases";
import { TIMELINE } from "@/lib/ground-truth/villa94-garden";
import { estimateOf } from "@/lib/hub/estimate";

import { docProgramme, programmeLabel, programmeOf } from "../programme";

// The pilot bathroom's BoQ after the client's comments (19 Oct), the lines the programme reads.
const L = (rule_id: string, quantity: number, unit: string, item_key?: string) => ({ rule_id, quantity, unit, ...(item_key ? { item_key } : {}) });
const PILOT = [
  { work_section: "Demolition", lines: [L("W-04/R-03", 27.53, "m2", "demo.wall_tile_removal"), L("W-05/R-02", 7, "m2", "demo.floor_removal")] },
  { work_section: "Waterproofing", lines: [L("W-09/R-55", 8.46, "m2", "wp.membrane"), L("W-10/R-55", 4.64, "m2", "wp.membrane")] },
  { work_section: "Floor Finishes", lines: [L("P4/quantify/floor_finish", 7, "m2"), L("W-11/R-05", 7, "m2", "floor.screed_wet")] },
  { work_section: "Wall Finishes", lines: [L("P4/quantify/wet_tiling", 27.53, "m2")] },
  { work_section: "Ceilings", lines: [L("W-14/R-54", 7, "m2", "ceiling.repair")] },
  { work_section: "Joinery", lines: [L("W-28/R-69", 1, "no"), L("W-25/R-66", 1, "no")] },
  { work_section: "Aluminum & Glass", lines: [L("W-26/R-67", 1, "no"), L("W-18/R-72", 1, "no")] },
  { work_section: "Sanitaryware", lines: [L("Q-24a/R-40", 1, "no"), L("W-15/R-71", 1, "no"), L("W-29/R-70", 1, "no"), L("W-27/R-68", 1, "no")] },
  { work_section: "Electrical", lines: [L("Q-17/R-14", 2, "no"), L("Q-18/R-15", 3, "no"), L("W-19/R-60", 1, "no"), L("W-20/R-61", 1, "no")] },
  { work_section: "Plumbing & Sanitary", lines: ["wc_point", "basin_point", "shower_mixer", "floor_drain", "shattaf_point"].map((t) => L(`P2/overlay/${t}`, 1, "no")) },
];

describe("B7 1c → C4: the bathroom's programme IS the engine — unchanged", () => {
  const p = programmeOf({ sections: PILOT })!;
  it("the pilot bathroom: 14 working days, the same phases", () => {
    expect(p.total_days).toBe(14);
    expect([p.low_days, p.high_days]).toEqual([11, 18]);
    expect(p.phases.map((ph) => [ph.label, ph.days])).toEqual([
      ["Protection & strip-out", 1],
      ["First fix — plumbing & electrical", 1],
      ["Screed to falls + cure", 2],
      ["Waterproofing + flood test", 2],
      ["Floor & wall tiling", 5],
      ["Ceiling repair & paint", 2],
      ["Fit-out — sanitaryware, joinery, glass, mirrors", 2],
      ["Snagging, clean & handover", 1],
    ]);
  });
  it("every phase says how its days were derived; the ceiling runs alongside the tiling", () => {
    expect(p.phases.every((ph) => ph.basis.length > 0)).toBe(true);
    expect(p.phases.find((ph) => ph.label.startsWith("Floor & wall"))!.basis).toBe("34.53 m² ÷ 8 m²/day");
    const tiling = p.phases.find((ph) => ph.label.startsWith("Floor & wall"))!, ceiling = p.phases.find((ph) => ph.label.startsWith("Ceiling"))!;
    expect(ceiling).toMatchObject({ parallel: true, start_day: tiling.start_day });
    expect(p.basis).toMatch(/Excludes lead times/);
    expect(p.basis).toMatch(/Indicative/);
  });
  it("nothing to programme → null (the page is dropped, never guessed)", () => {
    expect(programmeOf({ sections: [{ work_section: "Preliminaries", lines: [L("Q-32/R-27", 1, "project")] }] })).toBeNull();
    expect(programmeOf(null)).toBeNull();
  });
});

const ARABELLA = (arabella as unknown as { boqs: Record<string, Record<string, unknown>> }).boqs["e042b9eb-6053-41f4-8207-471e85d883f4"]!;
const PROJECTS: [string, Record<string, unknown>][] = [
  ["Jumeirah Parks Garden rev 1 (interior + garden)", jumeirah.boq.sections as never],
  ["Mudon pilot villa, 5 Sep (the reference villa)", mudon.boq.sections as never],
  ["Arabella garden rev 4", ARABELLA],
];

describe("one number per project on every surface", () => {
  it.each(PROJECTS)("%s", (_name, doc) => {
    const p = programmeOf(doc as never)!;
    expect(p).not.toBeNull();
    const n = p.total_days;
    // 05 Timeline + Overview: programmeLabel(programmeOf(latest)).
    expect(programmeLabel(p)).toBe(`≈ ${n} working days (${p.low_days}–${p.high_days})`);
    // The BoQ page (review model), the hub (estimateOf).
    const model = buildReviewModel({ projectId: "p", boqId: "b", rev: 1, revDate: "2026-10-21", persona: "owner", boq: doc as never, provenance: null, tierCtx: { qsValidated: {} }, firm: null, basis: null, duplicates: [], budget: null });
    expect(model.programme?.total_days).toBe(n);
    expect(estimateOf(doc as never, { withheldNames: [], qsValidated: {} }).programmeDays).toBe(n);
    expect(docProgramme(doc as never)!.total_days).toBe(n);
    // The BoQ PDF and the proposal print the same number.
    const pdf = buildBoqPdfPages({ projectName: "P", community: "Dubai", dateISO: "2026-10-21", boq: doc as never }).join("");
    expect(pdf).toContain(`data-programme-days="${n}"`);
    const proposal = buildProposalPages({ projectName: "P", community: "Dubai", dateISO: "2026-10-21", boq: doc as never, brand: "Contractor", logoDataUri: null, termsText: null, rooms: [] }).join("");
    expect(proposal).toContain(programmeLabel(p));
    // A stored programme (the retired value-scaled one) never reaches a surface.
    const stale = { ...doc, programme: { total_days: 135, phases: [{ name: "x", start_day: 1, days: 135 }], basis: "scaled" } };
    expect(buildReviewModel({ projectId: "p", boqId: "b", rev: 1, revDate: "2026-10-21", persona: "owner", boq: stale as never, provenance: null, tierCtx: { qsValidated: {} }, firm: null, basis: null, duplicates: [], budget: null }).programme?.total_days).toBe(n);
    expect(estimateOf(stale as never, { withheldNames: [], qsValidated: {} }).programmeDays).toBe(n);
  });
});

describe("reconciled with the reference projects — not tuned to them", () => {
  it("the reference villa: derived working days beside its recorded contract span; the reference garden excludes its lead times", () => {
    const villa = programmeOf(mudon.boq.sections as never)!;
    // Its recorded strip-out (14 days) and ceilings (12) are reproduced by the stated rates.
    expect(villa.phases.find((p) => p.label === "Protection & strip-out")!.days).toBe(14);
    expect(villa.phases.find((p) => p.label === "Ceilings")!.days).toBe(12);
    expect(villa.total_days).toBe(88);
    expect(MUDON_PROGRAMME_DAYS).toBe(82); // calendar days, 15 Jul → 5 Oct — the derived 88 is within ±10%.
    expect(Math.abs(villa.total_days - MUDON_PROGRAMME_DAYS) / MUDON_PROGRAMME_DAYS).toBeLessThan(0.1);
    const garden = programmeOf(ARABELLA as never)!;
    // The reference garden's 90 days ran mobilisation → handover INCLUDING fabrication and
    // deliveries; the programme counts site work only, and says so.
    expect(garden.total_days).toBe(28);
    expect(TIMELINE.actual_days).toBe(90);
    expect(garden.basis).toMatch(/lead times/);
    expect(programmeOf(jumeirah.boq.sections as never)!.total_days).toBe(70);
  });

  it("the retired engines are gone: no week model, no value-scaled programme", () => {
    for (const f of ["lib/timeline/estimate.ts", "lib/timeline/anchors.ts", "lib/timeline/drivers.ts", "lib/timeline/garden.ts", "lib/boq/programme.ts", "lib/timeline/room-programme.ts"]) expect(existsSync(path.join(ROOT, f)), f).toBe(false);
    for (const f of ["lib/hub/overview-view.ts", "lib/hub/estimate.ts", "lib/boq/review-model.ts", "lib/documents/boq-pdf-pages.ts", "lib/documents/proposal.ts", "lib/documents/proposal-view.ts", "lib/documents/room-pack-pdf.ts", "components/blueprint/timeline/TimelineView.tsx"]) {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      expect(src, f).not.toMatch(/total_weeks|boq\.programme\b|\bb\.programme\b|indicativeProgramme/);
    }
  });
});

import { describe, expect, it } from "vitest";

import { applyElementMapping } from "../element-map";
import { generateDeterministicBoq } from "../engine";
import { appendJoineryAluminumSections } from "../joinery-aluminum";
import { buildAluminumSection, buildJoinerySection } from "../joinery-aluminum";
import { appendOverlaySections } from "../../overlays/boq-feed";
import { buildFurnitureSection } from "../../staging/furniture-boq";
import { LABOUR_RATES_FIXTURE } from "./labour-rates.fixture";
import { PRICING_SKUS_FIXTURE } from "./pricing-skus.fixture";

// =============================================================================
// THE INVARIANT: every line in a generated BoQ carries a non-null rule_id.
//
// EXEMPTIONS: none. There is no class of unowned lines.
//
// "Furniture (optional)" is the one section that is not part of a generated
// BoQ — it is passed to the view as a separate prop and never written into
// boqs.sections, so a contractor export excludes it by construction. It still
// carries a rule_id, because leaving one writer able to omit provenance is
// exactly how this failed: the Joinery and Aluminum & Glass sections shipped
// for two sprints with blank rule_ids, which silently disabled the dedupe
// detector for R-46/47/48 and left two whole sections blank in the QS export.
//
// The test runs the REAL pipeline in the same order as
// app/api/generate-boq/route.ts. Asserting against a hand-built fixture would
// have passed throughout the period the bug existed.
// =============================================================================

const ROOMS = [
  { id: "r1", name_en: "Master Bedroom", room_type: "master_bedroom", area_m2: 18, polygon: [[0, 0], [5, 0], [5, 3.6], [0, 3.6]] },
  { id: "r2", name_en: "Bedroom 3", room_type: "bedroom", area_m2: 16, polygon: [[6, 0], [10, 0], [10, 4], [6, 4]] },
  { id: "r3", name_en: "Bath", room_type: "bathroom", area_m2: 6, polygon: [[0, 5], [3, 5], [3, 7], [0, 7]] },
  { id: "r4", name_en: "Master Bath", room_type: "ensuite", area_m2: 5, polygon: [[4, 5], [6.5, 5], [6.5, 7], [4, 7]] },
  { id: "r5", name_en: "Family Area", room_type: "living", area_m2: 24, polygon: [[0, 8], [6, 8], [6, 12], [0, 12]] },
  { id: "r6", name_en: "Terrace", room_type: "terrace", area_m2: 11, polygon: [[7, 8], [11, 8], [11, 10.75], [7, 10.75]] },
];

// The REAL labour_rates table (52 rows). A hand-written fixture made the rate
// resolver throw before any assertion ran — a failure that looks like a broken
// test rather than a broken invariant.
const LABOUR_RATES = LABOUR_RATES_FIXTURE;

function buildBoq() {
  const { boq } = generateDeterministicBoq({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rooms: ROOMS as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    labourRates: LABOUR_RATES as any,
    skus: PRICING_SKUS_FIXTURE,
    styleKey: "luxe-minimal",
  });
  return boq;
}

/** Every line across every section, tagged with where it came from. */
function allLines(boq: { sections: { work_section: string; lines: unknown[] }[] }) {
  return boq.sections.flatMap((s) =>
    (s.lines as { rule_id?: string | null; description?: string }[]).map((l) => ({
      section: s.work_section,
      rule_id: l.rule_id,
      description: l.description ?? "(no description)",
    })),
  );
}

describe("BoQ line provenance invariant", () => {
  it("engine lines all carry a rule_id", () => {
    for (const l of allLines(buildBoq())) {
      expect(l.rule_id, `${l.section} / ${l.description}`).toBeTruthy();
    }
  });

  it("survives element mapping", () => {
    const mapped = applyElementMapping(buildBoq(), [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { work_item_key: "wall_plaster", project_id: "p", room_id: "r1", element_id: "w1", qty: 100, unit: "m2", wet_area: false } as any,
    ]);
    for (const l of allLines(mapped)) {
      expect(l.rule_id, `${l.section} / ${l.description}`).toBeTruthy();
    }
  });

  it("holds after the joinery + aluminum actuals are appended", () => {
    const boq = appendJoineryAluminumSections(buildBoq(), ROOMS);
    const lines = allLines(boq);
    for (const l of lines) {
      expect(l.rule_id, `${l.section} / ${l.description}`).toBeTruthy();
    }
    // The sections that actually regressed — assert they are present AND owned,
    // so this cannot pass by the sections simply being absent.
    const joinery = lines.filter((l) => l.section === "Joinery");
    const alum = lines.filter((l) => l.section === "Aluminum & Glass");
    expect(joinery.length).toBeGreaterThan(0);
    expect(alum.length).toBeGreaterThan(0);
  });

  it("holds after overlay sections are appended", async () => {
    const fixtures = [
      { id: "f1", type: "socket_13a" },
      { id: "f2", type: "water_heater" },
    ];
    const supabase = {
      from() {
        const api = {
          select: () => api,
          eq: () => api,
          order: () => api,
          then: (res: (v: { data: unknown; error: null }) => void) =>
            Promise.resolve(res({ data: fixtures, error: null })),
        };
        return api;
      },
    };
    const prev = process.env.OVERLAYS_ENABLED;
    process.env.OVERLAYS_ENABLED = "true";
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const boq = await appendOverlaySections(buildBoq(), "p", supabase as any);
      const overlayLines = allLines(boq).filter((l) => l.section.includes("Installations") || l.section === "Plumbing & Sanitary");
      expect(overlayLines.length).toBeGreaterThan(0);
      for (const l of allLines(boq)) {
        expect(l.rule_id, `${l.section} / ${l.description}`).toBeTruthy();
      }
    } finally {
      if (prev === undefined) delete process.env.OVERLAYS_ENABLED;
      else process.env.OVERLAYS_ENABLED = prev;
    }
  });

  it("the S6-pre component lines carry their own R-xx ids", () => {
    const joinery = buildJoinerySection(ROOMS)!;
    const alum = buildAluminumSection(ROOMS)!;
    const ids = [...joinery.lines, ...alum.lines].map((l) => l.rule_id);
    expect(ids).toContain("S6-05/R-46"); // vanity slab
    expect(ids).toContain("S6-06/R-47"); // shower glass
    expect(ids).toContain("S6-07/R-48"); // mirror
  });

  it("ground-truth actuals carry a GT/ id rather than a blank", () => {
    const joinery = buildJoinerySection(ROOMS)!;
    const actuals = joinery.lines.filter((l) => l.rate_status === "actual_transaction");
    expect(actuals.length).toBeGreaterThan(0);
    for (const l of actuals) expect(l.rule_id).toMatch(/^GT\/joinery\//);
  });

  it("furniture lines carry a rule_id too, though the section is not in the BoQ", () => {
    const section = buildFurnitureSection(
      [{ roomId: "r1", roomName: "Master Bedroom", styleKey: "luxe-minimal", set: [{ key: "sofa-3seat" as const, label: "3-seat sofa", qty: 1 }] }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { "sofa-3seat": { ikea: 2000, home_centre: 2500, danube: 3000 } } as any,
    );
    if (section) {
      for (const l of section.lines) expect(l.rule_id).toMatch(/^P7\/furniture\//);
    }
  });
});

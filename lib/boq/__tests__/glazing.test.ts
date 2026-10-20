// C1: aluminium & glazing from the plan's own openings (lib/boq/glazing.ts),
// priced per m² of opening at R-75 / R-76 (calibrated, source private).

import { describe, expect, it } from "vitest";

import { buildPlanGraph, type BuildPlanGraphInput } from "@/lib/plan/geometry";
import { buildReviewModel } from "../review-model";
import { boqIssues } from "../issues";
import { pricedGlazing } from "../assemble";
import { GLAZING_UNREADABLE_REASON, glazingOpeningsFrom, glazingScope, NO_GLAZING_REASON } from "../glazing";
import { appendJoineryAluminumSections } from "../joinery-aluminum";
import { lineTotal } from "../money";
import { rateBasisOf } from "../rate-basis";
import { RateResolver } from "../rates";
import { RATE_RULES } from "../rules";

// A 10 × 8 m plan: living | bedroom on top, bath | terrace below; a lawn beyond the terrace.
//   w-liv  window on the living room's outside wall
//   d-ter  door living → terrace (external)
//   d-int  door living → bedroom (internal: joinery, not glazing)
//   d-out  door bedroom → outside
//   a-1    archway (never glazing)
function plan(extra: Partial<BuildPlanGraphInput> = {}) {
  return buildPlanGraph({
    projectId: "p",
    planId: "pl",
    scale: null,
    total_area_m2: 80,
    rooms: [
      { id: "liv", name_en: "Living Room", name_ar: null, room_type: "living", area_m2: 20, polygon: [[0, 0], [5, 0], [5, 4], [0, 4]] },
      { id: "bed", name_en: "Bedroom 2", name_ar: null, room_type: "bedroom", area_m2: 20, polygon: [[5, 0], [10, 0], [10, 4], [5, 4]] },
      { id: "bath", name_en: "Bath", name_ar: null, room_type: "bathroom", area_m2: 20, polygon: [[0, 4], [5, 4], [5, 8], [0, 8]] },
      { id: "ter", name_en: "Terrace", name_ar: null, room_type: "terrace", area_m2: 20, polygon: [[5, 4], [10, 4], [10, 8], [5, 8]] },
    ],
    openings: [
      { id: "w-liv", type: "window", width_mm: 1500, height_mm: 1200, position: [2.5, 0] },
      { id: "d-ter", type: "door", width_mm: 1800, height_mm: 2400, position: [5, 2.5] },
      { id: "d-int", type: "door", width_mm: 900, height_mm: 2100, position: [5, 1] },
      { id: "d-out", type: "door", width_mm: 1000, height_mm: 2100, position: [10, 2], derived: true },
      { id: "a-1", type: "archway", width_mm: 1200, height_mm: 2400, position: [2.5, 4] },
    ],
    ...extra,
  } as unknown as BuildPlanGraphInput);
}

describe("which openings are glazing", () => {
  it("windows and external doors; internal doors and archways are not", () => {
    // d-ter sits on the living/bedroom line at y = 2.5 — on this plan that wall is
    // living | bedroom, so it is internal; the terrace door is tested below.
    const kinds = Object.fromEntries(glazingOpeningsFrom(plan()).map((o) => [o.id, o.kind]));
    expect(kinds["w-liv"]).toBe("window");
    expect(kinds["d-out"]).toBe("external_door");
    expect(kinds["d-int"]).toBeUndefined();
    expect(kinds["a-1"]).toBeUndefined();
  });

  it("a door onto a terrace or an open zone is external", () => {
    const g = plan({ openings: [{ id: "d-t", type: "door", width_mm: 1800, height_mm: 2400, position: [7.5, 4] }] } as never);
    // bedroom (roofed) above, terrace below
    expect(glazingOpeningsFrom(g).map((o) => [o.id, o.kind, o.rooms])).toEqual([["d-t", "external_door", ["Bedroom 2"]]]);
  });

  it("each opening is named by this plan's own room; a defaulted size makes it derived", () => {
    const op = glazingOpeningsFrom(plan());
    expect(op.find((o) => o.id === "w-liv")).toMatchObject({ rooms: ["Living Room"], area_m2: 1.8, derived: false });
    expect(op.find((o) => o.id === "d-out")).toMatchObject({ rooms: ["Bedroom 2"], derived: true });
  });
});

describe("glazing lines", () => {
  const items = glazingScope(glazingOpeningsFrom(plan()));

  it("one line per kind, m² of opening, the openings as element refs, the measurement naming them", () => {
    expect(items.map((i) => [i.rule_id, i.item_key, i.quantity, i.unit, i.element_refs])).toEqual([
      ["Q-38", "alum.window", 1.8, "m2", ["w-liv"]],
      ["Q-39", "alum.external_door", 2.1, "m2", ["d-out"]],
    ]);
    expect(items[0]!.measurement).toBe("Σ 1 opening on the plan: W1 Living Room 1.50 × 1.20 m = 1.80 m²");
    expect(items[1]!.qty_derived).toBe(true);
  });

  it("priced through the resolver at R-75 / R-76 — calibrated, the supplier's role, never its name", () => {
    const { lines } = pricedGlazing({ rooms: [{ room_type: "living" }] as never, glazing: items, wetRoom: null }, new RateResolver([], [], "mid"));
    expect(lines.map((l) => [l.rule_id, l.rate_aed, l.total_aed])).toEqual([
      ["Q-38/R-75", 3324.1, lineTotal(1.8, 3324.1)],
      ["Q-39/R-76", 2623.47, lineTotal(2.1, 2623.47)],
    ]);
    for (const l of lines) {
      expect(l.vendor_or_source).toBe("reference villa — aluminium & glazing supplier");
      expect(rateBasisOf(l as never)).toBe("calibrated");
      expect(String(l.notes)).not.toMatch(/Mudon|Villa ?94|Global Creation|3936/);
    }
    // The rules' arithmetic, as stated in their notes.
    expect(Math.round((3000 / 0.9025) * 100) / 100).toBe(RATE_RULES["alum.window"]!.allowance_aed);
    expect(Math.round((36_600 / (1.85 * 2.46 + 1.7 * 2.3 + 1.83 * 3.0)) * 100) / 100).toBe(RATE_RULES["alum.external_door"]!.allowance_aed);
  });

  it("no openings drawn → no glazing lines, and the reason the Issues navigator shows", () => {
    const resolver = new RateResolver([], [], "mid");
    expect(pricedGlazing({ rooms: [{ room_type: "living" }] as never, glazing: [], wetRoom: null }, resolver)).toEqual({ lines: [], notPriced: NO_GLAZING_REASON });
    expect(pricedGlazing({ rooms: [{ room_type: "living" }] as never, glazing: null, wetRoom: null }, resolver).notPriced).toBe(GLAZING_UNREADABLE_REASON);
    // A garden-only plan and a wet-room package have no glazing to price — nothing to say.
    expect(pricedGlazing({ rooms: [{ room_type: "artificial_grass", unroofed: true }] as never, glazing: [], wetRoom: null }, resolver).notPriced).toBeNull();
    expect(pricedGlazing({ rooms: [{ room_type: "bathroom" }] as never, glazing: items, wetRoom: {} as never }, resolver)).toEqual({ lines: [], notPriced: null });
  });

  it("the reason reaches the Issues navigator as a plan check that opens the Openings layer", () => {
    const base = { sections: [{ work_section: "Plaster", lines: [], section_total_aed: 0 }], subtotal_aed: 0, contingency_pct: 8, contingency_aed: 0, vat_pct: 5, vat_aed: 0, grand_total_aed: 0 };
    const doc = appendJoineryAluminumSections(base, [{ room_type: "living" }], { lines: [], notPriced: NO_GLAZING_REASON });
    expect((doc as { glazing_not_priced?: string }).glazing_not_priced).toBe(NO_GLAZING_REASON);
    const model = buildReviewModel({ projectId: "p1", boqId: "b1", rev: 1, persona: "owner", boq: doc as never, provenance: null, qsValidated: {}, duplicates: [] } as never);
    expect(model.notices.glazing).toBe(NO_GLAZING_REASON);
    const g = boqIssues(model, null).groups.find((x) => x.key === "plan_check")!;
    expect(g.title).toBe("PLAN CHECK");
    expect(g.rows[0]).toMatchObject({ title: "No windows or doors drawn — glazing not priced.", action: "Open the plan", href: "/project/p1/plan?layer=openings" });
  });
});

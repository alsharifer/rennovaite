import { describe, expect, it } from "vitest";

import { applyElementMapping } from "@/lib/boq/element-map";
import { MAPPED_SECTIONS, roomRollup } from "@/lib/boq/elements";
import { elementPricer } from "@/lib/boq/rates";
import { mudonEngineBoq, mudonTakeoff } from "@/lib/boq/__tests__/p4.fixture";
import { validateEntry } from "@/lib/firms/vocabulary";
import { buildBoqProvenance, type ProvBoq } from "@/lib/provenance/boq";

import { FirmOverlay, FirmRateUnitError, type FirmRateEntry } from "../firm";
import { FIRM_CORRECTION_LABEL, FIRM_RATE_LABEL } from "../tiers";

// =============================================================================
// T3b REGRESSION — the six element sections price through the resolver.
//
// With the viewer flag on (VIEWER_3D_ENABLED — the P4 path), generate-boq
// replaces Demolition, Plaster, Floor Finishes, Wall Finishes, Ceilings and
// Painting with element-take-off lines. Before T3b those priced ONLY from the
// constants in lib/boq/elements.ts: a firm's private plaster rate never applied
// to the bulk of an interior BoQ. This runs the route's P4 order —
// engine → applyElementMapping(items, elementPricer(firm, tier)).
// =============================================================================

const FIRM = "00000000-0000-4000-8000-0000000000f1";
const BOOK = "00000000-0000-4000-8000-0000000000b1";
const entry = (over: Partial<FirmRateEntry>): FirmRateEntry => ({
  id: "e-plaster",
  firm_id: FIRM,
  book_id: BOOK,
  item_key: "wall_plaster",
  grade: null,
  unit: "m2",
  rate_aed: 41.5,
  kind: "supply_and_install",
  origin: "firm_entry",
  correction_id: null,
  ...over,
});
const overlay = (entries: FirmRateEntry[]) => FirmOverlay.forProject(FIRM, { firm_id: FIRM, book_id: BOOK, ohp_pct: 0, entries });

const p4 = (firm: FirmOverlay | null) => {
  const boq = mudonEngineBoq();
  return applyElementMapping(boq, mudonTakeoff(), elementPricer(firm, boq.engine.tier));
};
const plasterLine = (boq: ReturnType<typeof p4>) =>
  boq.sections.find((s) => s.work_section === "Plaster")!.lines.find((l) => (l as { rule_id?: string }).rule_id === "P4/quantify/wall_plaster") as {
    rate_aed: number; total_aed: number; quantity: number; vendor_or_source: string; rate_tier?: string; rate_band: string;
  };

describe("element sections resolve through the firm overlay (viewer flag on)", () => {
  it("a firm rate on a plaster item resolves tier-1 (firm_private)", () => {
    const line = plasterLine(p4(overlay([entry({})])));
    expect(line).toMatchObject({ rate_aed: 41.5, rate_tier: "firm_private", vendor_or_source: FIRM_RATE_LABEL, rate_band: "book" });
    expect(line.total_aed).toBe(Math.round(line.quantity * 41.5));
  });

  it("a promoted correction answers tier-2 when the firm has no own rate", () => {
    const line = plasterLine(p4(overlay([entry({ origin: "promoted_correction", correction_id: "c1", rate_aed: 47 })])));
    expect(line).toMatchObject({ rate_aed: 47, rate_tier: "firm_correction", vendor_or_source: FIRM_CORRECTION_LABEL });
  });

  it("only the firm's key moves; every other element line and the chain stay consistent", () => {
    const base = p4(null);
    const firm = p4(overlay([entry({})]));
    const lines = (b: typeof base) => b.sections.filter((s) => MAPPED_SECTIONS.includes(s.work_section)).flatMap((s) => s.lines as { rule_id?: string; rate_aed: number }[]);
    const moved = lines(firm).filter((l, i) => l.rate_aed !== lines(base)[i]!.rate_aed);
    expect(moved.map((l) => l.rule_id)).toEqual(["P4/quantify/wall_plaster"]);
    const plasterDelta = plasterLine(firm).total_aed - plasterLine(base).total_aed;
    expect(firm.subtotal_aed - base.subtotal_aed).toBe(plasterDelta);
  });

  it("no firm book → identical to the constant path (golden covers the bytes)", () => {
    const bytes = (b: ReturnType<typeof p4>) => JSON.stringify({ ...b, engine: { ...b.engine, generated_at: "" } });
    expect(bytes(p4(FirmOverlay.none()))).toBe(bytes(p4(null)));
    // A firm with an EMPTY book changes nothing either.
    expect(bytes(p4(overlay([])))).toBe(bytes(p4(null)));
    expect(plasterLine(p4(null)).rate_tier).toBeUndefined();
  });

  it("a firm element rate in the wrong unit refuses to price", () => {
    expect(() => p4(overlay([entry({ unit: "lm" })]))).toThrow(FirmRateUnitError);
  });

  it("room totals use the same element price as the mapped line", () => {
    const items = mudonTakeoff();
    const pricer = elementPricer(overlay([entry({})]), "mid");
    const plasterInRooms = roomRollup(items, pricer).flatMap((r) => r.items).filter((w) => w.work_item_key === "wall_plaster");
    // qty is shown rounded to 2 dp; the total is priced on the unrounded qty.
    for (const w of plasterInRooms) expect(Math.abs(w.total_aed - w.qty * 41.5)).toBeLessThanOrEqual(1);
    expect(plasterInRooms.length).toBeGreaterThan(0);
  });

  it("the popover names the tier on a firm-priced element line", () => {
    const p = buildBoqProvenance(p4(overlay([entry({})])) as unknown as ProvBoq);
    const key = Object.keys(p.lines).find((k) => p.lines[k]!.rate.title.includes("Wall plaster"))!;
    expect(p.lines[key]!.rate.steps.find((s) => s.kind === "tier")?.label).toBe("Private");
    expect(p.findings).toEqual([]);
  });

  it("a firm can enter a rate for each element work item", () => {
    for (const key of ["demolition", "wall_plaster", "floor_finish", "wet_tiling", "ceiling_finish", "wall_paint"]) {
      expect(validateEntry({ item_key: key, unit: "m2", rate_aed: 50, kind: "supply_and_install" }), key).toEqual([]);
    }
  });
});

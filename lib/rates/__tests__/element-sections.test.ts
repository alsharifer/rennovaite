import { readFileSync } from "node:fs";
import path from "node:path";

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

// =============================================================================
// U7 — the same resolution whether the viewer flag is on or off.
//
// Before U7 generate-boq gated the element mapping on VIEWER_3D_ENABLED: with
// the flag ON the six sections priced through elementPricer (a firm's
// `wall_plaster` rate applied); with it OFF they were the engine's rule lines
// (`plaster.make_good`…) and the same rate was silently ignored. A UI flag
// decided a pricing path. The mapping now runs whenever the plan yields a
// take-off; the flag gates the viewer and inspect UI only.
// =============================================================================

const SIX: { key: string; section: string; rate: number }[] = [
  { key: "demolition", section: "Demolition", rate: 77 },
  { key: "wall_plaster", section: "Plaster", rate: 41.5 },
  { key: "floor_finish", section: "Floor Finishes", rate: 150 },
  { key: "wet_tiling", section: "Wall Finishes", rate: 210 },
  { key: "ceiling_finish", section: "Ceilings", rate: 99 },
  { key: "wall_paint", section: "Decoration & Painting", rate: 28 },
];
const sixEntries = () => SIX.map((s, i) => entry({ id: `e-${i}`, item_key: s.key, rate_aed: s.rate }));
// Mudon's fixture take-off does not exercise every work item (no ceiling / wet
// tiling on the first floor as fixtured); one synthetic element per missing key
// makes all six sections present, so each is asserted, not skipped.
const sixTakeoff = () => {
  const items = mudonTakeoff();
  const present = new Set(items.map((i) => i.work_item_key));
  for (const s of SIX) {
    if (!present.has(s.key as (typeof items)[number]["work_item_key"])) {
      items.push({ work_item_key: s.key as (typeof items)[number]["work_item_key"], room_id: "room-synthetic", element_id: `el-${s.key}`, qty: 12.5, unit: "m2", wet_area: s.key === "wet_tiling" });
    }
  }
  return items;
};
const p4Six = (firm: FirmOverlay | null) => {
  const boq = mudonEngineBoq();
  return applyElementMapping(boq, sixTakeoff(), elementPricer(firm, boq.engine.tier));
};
const p4Line = (boq: ReturnType<typeof p4>, s: (typeof SIX)[number]) =>
  boq.sections.find((x) => x.work_section === s.section)!.lines.find((l) => (l as { rule_id?: string }).rule_id === `P4/quantify/${s.key}`) as { rate_aed: number; rate_tier?: string; vendor_or_source: string } | undefined;

describe("element-section resolution across viewer flag states (U7)", () => {
  const withFlag = <T,>(value: string | undefined, f: () => T): T => {
    const prev = process.env.VIEWER_3D_ENABLED;
    if (value === undefined) delete process.env.VIEWER_3D_ENABLED;
    else process.env.VIEWER_3D_ENABLED = value;
    try {
      return f();
    } finally {
      if (prev === undefined) delete process.env.VIEWER_3D_ENABLED;
      else process.env.VIEWER_3D_ENABLED = prev;
    }
  };
  const bytes = (b: ReturnType<typeof p4>) => JSON.stringify({ ...b, engine: { ...b.engine, generated_at: "" } });

  it.each([["true"], ["false"], [undefined]])("VIEWER_3D_ENABLED=%s: every one of the six sections resolves the firm's rate at tier 1", (flag) => {
    const boq = withFlag(flag, () => p4Six(overlay(sixEntries())));
    for (const s of SIX) {
      const line = p4Line(boq, s);
      expect(line, `${s.section} has its P4 line`).toBeDefined();
      expect(line, s.key).toMatchObject({ rate_aed: s.rate, rate_tier: "firm_private", vendor_or_source: FIRM_RATE_LABEL });
    }
  });

  it("the priced document is byte-identical with the flag on, off and unset", () => {
    const on = withFlag("true", () => bytes(p4Six(overlay(sixEntries()))));
    const off = withFlag("false", () => bytes(p4Six(overlay(sixEntries()))));
    const unset = withFlag(undefined, () => bytes(p4Six(overlay(sixEntries()))));
    expect(off).toBe(on);
    expect(unset).toBe(on);
  });

  it("generate-boq no longer gates the element take-off or mapping on the viewer flag", () => {
    // H3 moved the deterministic assembly to lib/boq/assemble.ts; the route
    // keeps the LLM path. Together they are the pricing path.
    const src = ["../../../app/api/generate-boq/route.ts", "../../boq/assemble.ts"].map((f) => readFileSync(path.resolve(__dirname, f), "utf8")).join("\n");
    expect(src).not.toMatch(/process\.env\.VIEWER_3D_ENABLED/);
    // The mapping is applied unconditionally on both engine and LLM paths.
    expect((src.match(/applyElementMapping\(/g) ?? []).length).toBe(2);
    expect(src).toMatch(/takeoffItems = quantifyPlan\(graph, \{ proposed \}\);/);
  });

  it("the resolver modules read no environment at all", () => {
    for (const f of ["lib/boq/element-map.ts", "lib/boq/elements.ts", "lib/boq/rates.ts", "lib/rates/firm.ts"]) {
      expect(readFileSync(path.resolve(__dirname, "../../..", f), "utf8"), f).not.toMatch(/process\.env/);
    }
  });
});

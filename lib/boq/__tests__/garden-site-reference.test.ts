import { describe, expect, it } from "vitest";

import { buildGardenSections as buildWithBook } from "@/lib/boq/garden-boq-feed";
import {
  computeGardenTakeoff as computeWithBook,
  DERIVED_QTY_NOTE,
  priceGardenTakeoff as priceWithBook,
  UNPRICED_SOURCE_LABEL,
  type GardenTakeoffInput,
} from "@/lib/boq/garden-takeoff";
import { PUBLIC_SOURCE_LABEL } from "@/lib/ground-truth/villa94-garden";
import { DRAFT_STATEMENT, draftStatus, isDemolished, isInDesign, isNewWork, isUndecided, replacedBy } from "@/lib/plan/site-reference";
import { transcriptionGardenBook } from "@/lib/boq/garden-rates";

// T1.0: the take-off prices through a rate book. These tests check the rules
// against the transcription, so they use the offline transcription book.
const BOOK = transcriptionGardenBook();
const computeGardenTakeoff = (i: Parameters<typeof computeWithBook>[0]) => computeWithBook(i, BOOK);
const priceGardenTakeoff = (i: Parameters<typeof priceWithBook>[0]) => priceWithBook(i, BOOK);
const buildGardenSections = (i: Parameters<typeof buildWithBook>[0]) => buildWithBook(i, BOOK);

const lawn = { id: "z-lawn", name: "Lawn", kind: "artificial_grass", area_m2: 40 };
const gazebo = (disposition: "keep" | "remove" | "replace" | null) => ({ id: "z-gazebo", name: "Gazebo (existing)", kind: "structure", area_m2: 12.25, site_reference: true, disposition });
const sink = (disposition: "keep" | "remove" | "replace" | null) => ({ id: "r-sink", kind: "counter_run" as const, length_m: 2.4, name: "Sink counter (existing)", site_reference: true, disposition });

const keys = (input: GardenTakeoffInput) => computeGardenTakeoff(input).items.map((i) => i.item_key);

describe("site reference — the keep marker", () => {
  it("excludes a kept item from demolition AND new-work quantities", () => {
    const t = computeGardenTakeoff({ zones: [lawn, gazebo("keep")], runs: [sink("keep")] });
    expect(t.items.map((i) => i.item_key)).not.toContain("garden.pergola");
    expect(t.items.map((i) => i.item_key)).not.toContain("garden.counter_bar");
    expect(t.elements.some((e) => e.element_id === "z-gazebo" || e.element_id === "r-sink")).toBe(false);
    expect(t.removals).toEqual([]);
    expect(t.kept.map((k) => k.element_id).sort()).toEqual(["r-sink", "z-gazebo"]);
    // No untyped counter is left to answer: the kept one is not new work.
    expect(t.items.some((i) => i.rate_status === "needs_selection")).toBe(false);
    // The paved surface under a kept gazebo is existing, not new paving.
    expect(t.summary.pavedAreaM2 + t.summary.structurePlanAreaM2).toBe(0);
  });

  it("counts a removed item toward demolition only", () => {
    const t = computeGardenTakeoff({ zones: [lawn, gazebo("remove")], runs: [sink("remove")] });
    expect(t.removals.map((r) => [r.element_id, r.qty, r.unit, r.disposition])).toEqual([
      ["z-gazebo", 12.25, "m2", "remove"],
      ["r-sink", 2.4, "lm", "remove"],
    ]);
    expect(keys({ zones: [lawn, gazebo("remove")] })).not.toContain("garden.pergola");
    const demo = t.items.find((i) => i.item_key === "garden.demolition")!;
    expect(demo.measurement).toContain("Gazebo (existing) (12.25 m2, remove)");
  });

  it("counts a replaced item toward both", () => {
    const t = computeGardenTakeoff({ zones: [lawn, gazebo("replace")], runs: [{ ...sink("replace"), variant: "bbq" }] });
    expect(t.removals.map((r) => r.element_id).sort()).toEqual(["r-sink", "z-gazebo"]);
    expect(t.items.find((i) => i.item_key === "garden.pergola")!.quantity).toBe(12.25);
    expect(t.items.find((i) => i.item_key === "garden.counter_bbq")!.quantity).toBe(2.4);
  });

  it("counts an item replaced by a DIFFERENT design element toward demolition only", () => {
    const replaced = { ...sink("replace"), replaced_by: "BBQ counter under the new pergola" };
    const bbq = { id: "r-bbq", kind: "counter_run" as const, length_m: 3, name: "BBQ counter", variant: "bbq" as const };
    const t = computeGardenTakeoff({ zones: [lawn], runs: [replaced, bbq] });
    expect(t.removals.map((r) => [r.element_id, r.replaced_by])).toEqual([["r-sink", "BBQ counter under the new pergola"]]);
    // The new work is the replacing element's alone — never the old item priced again.
    expect(t.items.find((i) => i.item_key === "garden.counter_bbq")!.quantity).toBe(3);
    expect(t.elements.some((e) => e.element_id === "r-sink")).toBe(false);
    expect(t.items.find((i) => i.item_key === "garden.demolition")!.measurement).toContain("replaced by BBQ counter under the new pergola");
    expect(isNewWork(replaced)).toBe(false);
    expect(isDemolished(replaced)).toBe(true);
    expect(isInDesign(replaced)).toBe(false);
    // Like-for-like (no replaced_by) is still both.
    expect(isNewWork(sink("replace"))).toBe(true);
    expect(isInDesign(sink("replace"))).toBe(true);
    expect(replacedBy({ site_reference: true, disposition: "replace", spec: { replaced_by: " designed lighting " } })).toBe("designed lighting");
    expect(replacedBy({ site_reference: true, disposition: "remove", spec: { replaced_by: "x" } })).toBeNull();
  });

  it("leaves an undecided item out of both, and lists it", () => {
    const t = computeGardenTakeoff({ zones: [lawn, gazebo(null)] });
    expect(t.undecided.map((u) => u.element_id)).toEqual(["z-gazebo"]);
    expect(t.removals).toEqual([]);
    expect(t.items.map((i) => i.item_key)).not.toContain("garden.pergola");
  });

  it("traces the demolition line to what it takes out", () => {
    const built = buildGardenSections({ zones: [lawn, gazebo("remove")], runs: [sink("keep")] });
    const demo = built.sections.flatMap((s) => s.lines).find((l) => l.rule_id === "GL-03")!;
    expect(demo.element_refs).toEqual(["z-gazebo"]);
  });

  it("agrees with the shared vocabulary", () => {
    expect([isNewWork({}), isDemolished({}), isInDesign({})]).toEqual([true, false, true]);
    expect([isNewWork({ site_reference: true, disposition: "keep" }), isDemolished({ site_reference: true, disposition: "keep" })]).toEqual([false, false]);
    expect([isNewWork({ site_reference: true, disposition: "remove" }), isDemolished({ site_reference: true, disposition: "remove" }), isInDesign({ site_reference: true, disposition: "remove" })]).toEqual([false, true, false]);
    expect([isNewWork({ site_reference: true, disposition: "replace" }), isDemolished({ site_reference: true, disposition: "replace" })]).toEqual([true, true]);
    expect(isUndecided({ site_reference: true, disposition: null })).toBe(true);
    expect(isUndecided({ site_reference: false })).toBe(false);
  });
});

describe("work with no reference rate is visible, not silent", () => {
  it("prices a deck zone, a stepping path, string lights and new trees at 0, flagged needs_qs", () => {
    const t = computeGardenTakeoff({
      zones: [{ id: "z-deck", name: "Deck", kind: "deck", area_m2: 22.05 }],
      runs: [{ id: "r-path", kind: "stepping_path", length_m: 27 }, { id: "r-sl", kind: "string_light_run", length_m: 12 }],
      units: [{ id: "u-tree", kind: "tree" }],
    });
    const priced = priceGardenTakeoff(t.items);
    for (const key of ["garden.deck", "garden.stepping_path", "garden.string_lights", "garden.tree"]) {
      const l = priced.find((p) => p.item_key === key)!;
      expect(l.rate_status, key).toBe("needs_qs");
      expect([l.rate_aed, l.total_aed]).toEqual([0, 0]);
      expect(l.vendor_or_source).toBe(UNPRICED_SOURCE_LABEL);
    }
    expect(priced.find((p) => p.item_key === "garden.deck")!.quantity).toBe(22.05);
    // The market-reference label stays on priced lines only.
    expect(priced.filter((p) => p.vendor_or_source === PUBLIC_SOURCE_LABEL).every((p) => p.rate_aed > 0)).toBe(true);
  });
});

describe("derived dimensions", () => {
  it("flags every quantity measured off derived geometry, and only those", () => {
    const t = computeGardenTakeoff({
      zones: [{ ...lawn, dims_derived: true }, { id: "z-pave", name: "Paving", kind: "paving", area_m2: 10 }],
    });
    const grass = t.items.find((i) => i.item_key === "garden.grass_supply")!;
    const pcc = t.items.find((i) => i.item_key === "garden.pcc_base")!;
    expect(grass.qty_derived).toBe(true);
    expect(grass.measurement).toContain(DERIVED_QTY_NOTE);
    expect(pcc.qty_derived).toBeUndefined();
    expect(t.items.find((i) => i.item_key === "garden.preliminaries")!.qty_derived).toBeUndefined();
  });

  it("is a draft while any boundary-critical dimension is derived", () => {
    const base = { plot_dims_derived: false, dims_note: "calibrated", zones: [], runs: [], context: [] };
    expect(draftStatus(base)).toEqual({ draft: false, derived: [], note: null, statement: null });
    const d = draftStatus({ ...base, plot_dims_derived: true, zones: [{ id: "a", name: "Lawn", dims_derived: true }] });
    expect(d.draft).toBe(true);
    expect(d.derived).toEqual(["plot boundary", "zone: Lawn"]);
    expect(d.statement).toBe(DRAFT_STATEMENT);
    expect(DRAFT_STATEMENT).toBe("DRAFT FOR REVIEW — quantities derived from reference layout; firm after site verification.");
  });
});

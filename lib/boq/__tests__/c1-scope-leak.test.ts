// Sprint C1 — the Jumeirah scope leak (docs/SPRINT_C_ROOT_CAUSE.md §1), on the
// production revisions themselves (read-only fixtures, curated):
//
//   - the stored revisions DO name rooms their plans lack (the defect, proven
//     by the same check that guards the fix);
//   - re-run through today's aluminium post-pass — glazing from the plan's own
//     openings — no line names a room absent from its own plan, Mudon's
//     included (its quotation's labels never matched its own plan either);
//   - the totals move by exactly the removed quotation lines plus the plan's
//     own glazing, to the fil.

import { describe, expect, it } from "vitest";

import jumeirah from "../__fixtures__/c1-jumeirah-rev1.json";
import mudon from "../__fixtures__/c1-mudon-latest.json";
import { pricedGlazing } from "../assemble";
import { glazingOpeningsFrom, glazingScope, NO_GLAZING_REASON } from "../glazing";
import { appendJoineryAluminumSections } from "../joinery-aluminum";
import { lineTotal, sumMoney } from "../money";
import { RateResolver } from "../rates";
import { buildPlanGraph } from "../../plan/geometry";
import { metresPerUnit, openingsOnWalls } from "../../plan/plan-rules";
import { foreignRooms } from "../../identity/surface-scan";

type Fx = typeof jumeirah;

/** The graph derivePlanGraph builds from these rows (unconfirmed detections and "Needs a wall" left out). */
function graphOf(fx: Fx) {
  const rooms = fx.rooms.map((r) => ({ id: r.id, name_en: r.name_en, name_ar: null, room_type: r.room_type, area_m2: r.area_m2, polygon: r.polygon, unroofed: r.unroofed }));
  const mPerU = metresPerUnit(rooms, fx.plan.total_area_m2);
  const confirmed = fx.openings.filter((o) => !(o.source === "detected" && !o.confirmed_at));
  const onWalls = new Set(openingsOnWalls(confirmed.map((o) => ({ id: o.id, kind: o.kind, width_mm: o.width_mm, position: o.position, room_id: o.room_id, context_id: o.context_id })), rooms, mPerU).map((o) => o.id));
  return buildPlanGraph({
    projectId: fx.project.id,
    planId: fx.plan.id,
    scale: null,
    total_area_m2: fx.plan.total_area_m2,
    rooms,
    openings: confirmed.filter((o) => onWalls.has(o.id)).map((o) => ({ id: o.id, wall_ref: o.wall_ref, room_id: o.room_id, type: o.kind, width_mm: o.width_mm, height_mm: o.height_mm, sill_mm: o.sill_mm, position: o.position, along_offset: null, source: o.source, derived: o.derived })),
  } as never);
}

const inScope = (fx: Fx) => fx.rooms.filter((r) => r.in_scope !== false);

/** Today's aluminium post-pass over the stored revision: the plan's own glazing, priced at R-75 / R-76. */
function rerun(fx: Fx) {
  const rooms = inScope(fx).map((r) => ({ id: r.id, name_en: r.name_en, room_type: r.room_type, area_m2: r.area_m2, polygon: r.polygon }));
  const glazing = glazingScope(glazingOpeningsFrom(graphOf(fx), new Set(rooms.map((r) => r.id))));
  const input = pricedGlazing({ rooms, glazing, wetRoom: null }, new RateResolver([], [], "mid"));
  return { doc: appendJoineryAluminumSections(fx.boq.sections as never, rooms, input) as unknown as typeof fx.boq.sections, input, glazing };
}

type Line = { rule_id?: string | null; description: string; notes?: string | null; total_aed: number };
const linesOf = (doc: { sections: { work_section: string; lines: unknown[] }[] }) => doc.sections.flatMap((s) => s.lines as Line[]);
const textOf = (l: Line) => [l.description, l.notes ?? "", l.rule_id ?? ""].join(" · ");
const foreignIn = (fx: Fx, doc: { sections: { work_section: string; lines: unknown[] }[] }) =>
  linesOf(doc).flatMap((l) => foreignRooms(textOf(l), { ownRooms: fx.rooms.map((r) => r.name_en) }).map((room) => `${room} ← ${l.description}`));
const quotationTotal = (doc: { sections: { lines: unknown[] }[] }) => sumMoney(linesOf(doc as never).filter((l) => (l.rule_id ?? "").startsWith("GT/aluminum/") || /— (Thermal-break|Tilt & turn|Skylight|Shaped glass)/.test(l.description)).map((l) => l.total_aed));

describe.each([
  ["Jumeirah Parks Garden — rev 1 (13 Oct)", jumeirah as Fx],
  ["Mudon pilot villa — latest (5 Sep)", mudon as unknown as Fx],
])("%s", (_name, fx) => {
  it("the stored revision names rooms its plan does not have (the defect)", () => {
    const found = foreignIn(fx, fx.boq.sections as never);
    expect(found.length).toBeGreaterThan(0);
    expect(quotationTotal(fx.boq.sections as never)).toBe(92_449);
  });

  it("today's post-pass: no line names a room absent from its own plan", () => {
    expect(foreignIn(fx, rerun(fx).doc as never)).toEqual([]);
  });

  it("the glazing is this plan's own openings, each named by its own room", () => {
    const { doc, glazing } = rerun(fx);
    const alu = linesOf(doc as never).filter((l) => /^Q-3[89]\//.test(l.rule_id ?? ""));
    expect(alu.map((l) => (l as unknown as { item_key: string }).item_key).sort()).toEqual(glazing.map((g) => g.item_key).sort());
    for (const l of alu) {
      const g = glazing.find((x) => x.item_key === (l as unknown as { item_key: string }).item_key)!;
      expect((l as unknown as { quantity: number }).quantity).toBe(g.quantity);
      expect(l.total_aed).toBe(lineTotal(g.quantity, g.item_key === "alum.window" ? 3324.1 : 2623.47));
      expect((l as unknown as { element_refs: string[] }).element_refs).toEqual(g.element_refs);
    }
  });

  it("the total moves by exactly the removed quotation lines, the plan's own glazing and the named S6-pre drift, to the fil", () => {
    const { doc, input } = rerun(fx);
    const before = fx.boq.sections as unknown as { subtotal_aed: number };
    const after = doc as unknown as { subtotal_aed: number; contingency_aed: number; vat_aed: number; grand_total_aed: number; ohp_aed?: number };
    const added = sumMoney(input.lines.map((l) => l.total_aed));
    // Lines the post-pass rebuilds that are neither the quotation nor the glazing,
    // and were not on the stored revision: the S6-pre components added on 8 Sep
    // (H3) — present on a revision stored before them (Mudon, 5 Sep), never on
    // Jumeirah's (13 Oct). Named, so a C1 change can never hide in them.
    const stored = new Set(linesOf(fx.boq.sections as never).map((l) => l.description));
    const drift = linesOf(doc as never).filter((l) => !/^Q-3[89]\//.test(l.rule_id ?? "") && !stored.has(l.description));
    expect(drift.map((l) => (l.rule_id ?? "").split("/")[0]).sort()).toEqual(EXPECTED_DRIFT[fx.project.id] ?? []);
    expect(after.subtotal_aed).toBe(sumMoney([before.subtotal_aed, -92_449, added, ...drift.map((l) => l.total_aed)]));
    expect(after.grand_total_aed).toBe(sumMoney([after.subtotal_aed, after.ohp_aed ?? 0, after.contingency_aed, after.vat_aed]));
  });
});

/** Pre-existing drift a re-run brings in, by project: Mudon's 5 Sep revision predates the S6-pre lines. */
const EXPECTED_DRIFT: Record<string, string[]> = {
  "6b5fda9d-e40f-4e16-940c-7a17d27ec5dc": ["S6-05", "S6-06", "S6-07"],
};

it("Jumeirah's glazing: 8 windows on its own rooms, no external door (every door opens to a room)", () => {
  const { glazing } = rerun(jumeirah as Fx);
  expect(glazing.map((g) => g.item_key)).toEqual(["alum.window"]);
  expect(glazing[0]!.element_refs).toHaveLength(8);
  expect(glazing[0]!.qty_derived).toBe(true);
  for (const room of ["Guest bedroom", "Office", "Kids bedroom", "Master bedroom"]) expect(glazing[0]!.measurement).not.toContain(room);
});

it("a plan with interior rooms and no windows or doors prices no glazing and says so", () => {
  const fx = { ...(jumeirah as Fx), openings: [] };
  const { doc, input } = rerun(fx);
  expect(input.lines).toEqual([]);
  expect(input.notPriced).toBe(NO_GLAZING_REASON);
  expect((doc as unknown as { glazing_not_priced?: string }).glazing_not_priced).toBe("No windows or doors drawn — glazing not priced.");
  expect(linesOf(doc as never).some((l) => /^Q-3[89]\//.test(l.rule_id ?? "") || (l.rule_id ?? "").startsWith("GT/aluminum/"))).toBe(false);
});

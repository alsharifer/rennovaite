import { describe, expect, it } from "vitest";

import { arabellaPlanInput, SOURCE_NOTE } from "@/lib/client-garden/arabella-reference";
import { buildPlanGraph } from "@/lib/plan/geometry";
import { MUDON_FIXTURE } from "@/lib/plan/__tests__/mudon.fixture";
import { netCeilingChange, ceilingChangeSummary } from "@/lib/plan/ceiling";

import { applyElementMapping } from "../element-map";
import { roomRollup } from "../elements";
import { generateDeterministicBoq } from "../engine";
import { MUDON_FIRST_FLOOR } from "../fixtures/mudon-first-floor";
import { quantifyPlan } from "../quantify";
import { computeTakeoff } from "../takeoff";
import { summarizeChanges } from "../changes-since";
import { LABOUR_RATES_FIXTURE } from "./labour-rates.fixture";
import { PRICING_SKUS_FIXTURE } from "./pricing-skus.fixture";

// =============================================================================
// B1 (migration 061) — a room's stored ceiling height, and the invariant that
// makes it safe: a room that stores NONE behaves exactly as before. Mudon and
// Arabella regenerate line for line (the element-mapping golden is the same
// file the P4 golden pins), and only a stored height moves a wall area.
// =============================================================================

function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "generated_at" || k === "item_key") continue;
      out[k] = strip(x);
    }
    return out;
  }
  return v;
}

/** The rooms as a 061 database returns them: the columns present, no height stated. */
const withNullCeilings = <T extends { rooms: object[] }>(input: T): T => ({ ...input, rooms: input.rooms.map((r) => ({ ...r, ceiling_h_m: null, ceiling_h_source: null })) });

const engine = (rooms = MUDON_FIRST_FLOOR) =>
  generateDeterministicBoq({
    rooms,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    labourRates: LABOUR_RATES_FIXTURE as any,
    skus: PRICING_SKUS_FIXTURE,
    styleKey: "contemporary-majlis",
  }).boq;

describe("B1 — no existing BoQ figure moves", () => {
  it("Mudon: the element-mapped BoQ with 061's columns present (no height stated) is the P4 golden, byte for byte", async () => {
    const items = quantifyPlan(buildPlanGraph(withNullCeilings(MUDON_FIXTURE)));
    const mapped = applyElementMapping(engine(), items);
    await expect(JSON.stringify(strip({ mapped, rooms: roomRollup(items) }), null, 2)).toMatchFileSnapshot("./__snapshots__/element-mapping.golden.json");
  });

  it("Mudon: the plan graph and every take-off row are identical with and without the columns", () => {
    const a = buildPlanGraph(MUDON_FIXTURE);
    const b = buildPlanGraph(withNullCeilings(MUDON_FIXTURE));
    expect(b).toEqual(a);
    expect(quantifyPlan(b)).toEqual(quantifyPlan(a));
    expect(a.rooms.every((r) => r.ceiling_h_source === undefined && (r.unroofed || r.ceiling_h_m === 2.9))).toBe(true);
    expect(a.derived.ceiling_h).toBe(true);
  });

  it("Mudon: the engine take-off is identical with no stored height (C-01 / C-04 still 2.9 m, the same measurement text)", () => {
    const before = computeTakeoff(MUDON_FIRST_FLOOR, "porcelain");
    const after = computeTakeoff(MUDON_FIRST_FLOOR.map((r) => ({ ...r, ceiling_h_m: undefined })), "porcelain");
    expect(after).toEqual(before);
    expect(before.items.find((i) => i.rule_id === "Q-03")!.measurement).toMatch(/perimeter × 2\.9 m − door/);
  });

  it("Arabella: the garden graph and its take-off are identical with the columns — and an open zone ignores a stored height", () => {
    const p = arabellaPlanInput({});
    const input = { projectId: "arabella", planId: "plan", scale: null, total_area_m2: 0, rooms: p.rooms, elements: p.elements, context: p.context, unit_to_m: p.plot.width_m, plot: p.plot, plot_dims_derived: true, dims_note: SOURCE_NOTE, source: "user_drawn" as const };
    const a = buildPlanGraph(input);
    expect(buildPlanGraph(withNullCeilings(input))).toEqual(a);
    const stated = buildPlanGraph({ ...input, rooms: input.rooms.map((r) => ({ ...r, ceiling_h_m: 3.1, ceiling_h_source: "measured" })) });
    for (const z of stated.rooms.filter((r) => r.unroofed)) {
      expect(z.ceiling_h_m).toBe(0);
      expect(z.ceiling_h_source).toBeUndefined();
    }
    expect(quantifyPlan(buildPlanGraph(withNullCeilings(input)))).toEqual(quantifyPlan(a));
  });
});

describe("B1 — a stored height moves exactly the wall areas of its room", () => {
  it("element take-off: the Master Bath at 2.80 m changes its wet tiling and its walls only", () => {
    const base = buildPlanGraph(MUDON_FIXTURE);
    const g = buildPlanGraph({ ...MUDON_FIXTURE, rooms: MUDON_FIXTURE.rooms.map((r) => (r.id === "mbath-01" ? { ...r, ceiling_h_m: 2.8, ceiling_h_source: "measured" } : r)) });
    const mb = g.rooms.find((r) => r.id === "mbath-01")!;
    expect(mb.ceiling_h_m).toBe(2.8);
    expect(mb.derived_fields).not.toContain("ceiling_h_m");
    expect(g.derived.ceiling_h).toBe(true); // the other rooms still default
    const A = quantifyPlan(base), B = quantifyPlan(g);
    const key = (i: (typeof A)[number]) => `${i.work_item_key}|${i.element_id}`;
    const changed = B.filter((b) => A.find((a) => key(a) === key(b))!.qty !== b.qty);
    // The Master Bath's own tiling, and walls whose tallest neighbour was only it.
    expect(changed.find((c) => c.work_item_key === "wet_tiling")?.room_id).toBe("mbath-01");
    for (const c of changed) expect(["wet_tiling", "wall_plaster", "wall_paint"]).toContain(c.work_item_key);
    const tilingA = A.find((i) => i.work_item_key === "wet_tiling" && i.room_id === "mbath-01")!;
    const tilingB = B.find((i) => i.work_item_key === "wet_tiling" && i.room_id === "mbath-01")!;
    // The fixture carries no openings, so the tiling is perimeter × height outright.
    expect(tilingB.qty / tilingA.qty).toBeCloseTo(2.8 / 2.9, 3);
  });

  it("engine take-off: a bathroom's stored height drives F-03 and its walls, and the measurement says so", () => {
    const rooms = MUDON_FIRST_FLOOR.map((r) => (r.room_type === "bathroom" || r.room_type === "ensuite" ? { ...r, ceiling_h_m: 2.8 } : r));
    const t = computeTakeoff(rooms, "porcelain");
    const base = computeTakeoff(MUDON_FIRST_FLOOR, "porcelain");
    expect(t.summary.bathWetWallM2).toBeCloseTo(base.summary.bathWetWallM2 * (2.8 / 2.9), 1);
    expect(t.items.find((i) => i.rule_id === "Q-03")!.measurement).toMatch(/the room's ceiling height/);
  });

  it("the revision cause: the net change in the window, named on the wall-area lines", () => {
    const net = netCeilingChange([
      { rooms: [{ id: "a", name: "Bathroom", from: null, to: 2.75 }] },
      { rooms: [{ id: "a", name: "Bathroom", from: 2.75, to: 2.8 }, { id: "b", name: "Hall", from: null, to: 2.9 }] },
    ]);
    // Stating 2.90 over the 2.90 default moves nothing — not a cause.
    expect(net).toEqual([{ id: "a", name: "Bathroom", from: null, to: 2.8 }]);
    expect(ceilingChangeSummary(net)).toBe("Bathroom 2.90 (default) → 2.80 m");
    expect(summarizeChanges([{ kind: "ceiling_height" }], 3).summary).toBe("Ceiling height changed since rev 3");
  });
});

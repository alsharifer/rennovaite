import { describe, expect, it } from "vitest";

import { quantifyPlan } from "@/lib/boq/quantify";
import {
  buildPlanGraph,
  deriveWallSegments,
  type BuildPlanGraphInput,
} from "@/lib/plan/geometry";

// Two 50 m² rooms sharing a vertical party wall at x=0.5 → 10 m × 10 m metric.
const base: BuildPlanGraphInput = {
  projectId: "p",
  planId: "pl",
  scale: "1:100",
  total_area_m2: 100,
  rooms: [
    { id: "a", name_en: "A", name_ar: null, room_type: "living", area_m2: 50, polygon: [[0, 0], [0.5, 0], [0.5, 1], [0, 1]] },
    { id: "b", name_en: "B", name_ar: null, room_type: "bedroom", area_m2: 50, polygon: [[0.5, 0], [1, 0], [1, 1], [0.5, 1]] },
  ],
};

describe("buildPlanGraph — openings ingestion (A3/A5)", () => {
  it("is empty (flagged) when no openings are supplied", () => {
    const g = buildPlanGraph(base);
    expect(g.openings).toEqual([]);
    expect(g.derived.openings_empty).toBe(true);
  });

  it("ingests an opening, defaults its dimensions (derived), and snaps it to the nearest wall", () => {
    const g = buildPlanGraph({
      ...base,
      openings: [{ id: "o1", type: "door", position: [0.5, 0.5] }],
    });
    expect(g.openings).toHaveLength(1);
    expect(g.derived.openings_empty).toBe(false);
    const o = g.openings[0]!;
    expect(o.type).toBe("door");
    expect(o.width_mm).toBe(900); // standard door default
    expect(o.height_mm).toBe(2100);
    expect(o.derived).toBe(true); // dimensions defaulted, not measured
    expect(o.wall_id).not.toBeNull();
    // Position converts to metric (plan is 10 m; midpoint ≈ [5,5]).
    expect(o.position![0]).toBeCloseTo(5, 1);
    expect(o.position![1]).toBeCloseTo(5, 1);
    // Snapped to a vertical wall at x≈5 → about halfway along it.
    expect(o.along_offset).toBeCloseTo(0.5, 1);
  });

  it("keeps measured dimensions non-derived", () => {
    const g = buildPlanGraph({
      ...base,
      openings: [{ id: "o1", type: "window", position: [0.5, 0.3], width_mm: 1500, height_mm: 1400, source: "parsed" }],
    });
    const o = g.openings[0]!;
    expect(o.width_mm).toBe(1500);
    expect(o.derived).toBe(false);
    expect(o.source).toBe("parsed");
  });
});

describe("quantify — net wall quantities deduct opening area", () => {
  it("reduces the opening's wall plaster/paint by the opening area", () => {
    const withOpening = buildPlanGraph({
      ...base,
      openings: [{ id: "o1", type: "door", position: [0.5, 0.5] }],
    });
    const o = withOpening.openings[0]!;
    const plasterFor = (graph: ReturnType<typeof buildPlanGraph>, wallId: string) =>
      quantifyPlan(graph).find((it) => it.work_item_key === "wall_plaster" && it.element_id === wallId)?.qty ?? null;

    const gross = plasterFor(buildPlanGraph(base), o.wall_id!); // same wall, no opening
    const net = plasterFor(withOpening, o.wall_id!);
    expect(gross).not.toBeNull();
    expect(net).not.toBeNull();
    // Door 0.9×2.1 = 1.89 m² deducted.
    expect(gross! - net!).toBeCloseTo(1.89, 1);
  });
});

// --- A5: wet-area tiling deduction + provenance ------------------------------

// Two 50 m² rooms sharing a party wall; room A is a bathroom so it gets
// full-height wet tiling measured on its perimeter.
const wet: BuildPlanGraphInput = {
  ...base,
  rooms: [
    { id: "a", name_en: "Bath", name_ar: null, room_type: "bathroom", area_m2: 50, polygon: [[0, 0], [0.5, 0], [0.5, 1], [0, 1]] },
    { id: "b", name_en: "B", name_ar: null, room_type: "bedroom", area_m2: 50, polygon: [[0.5, 0], [1, 0], [1, 1], [0.5, 1]] },
  ],
};

describe("quantify — wet-area tiling deducts openings (A5)", () => {
  const tilingFor = (g: ReturnType<typeof buildPlanGraph>) =>
    quantifyPlan(g).find((it) => it.work_item_key === "wet_tiling" && it.room_id === "a");

  it("deducts a door on the bathroom's wall from its wet tiling", () => {
    const gross = tilingFor(buildPlanGraph(wet));
    const net = tilingFor(
      buildPlanGraph({ ...wet, openings: [{ id: "o1", type: "door", position: [0.5, 0.5] }] }),
    );
    expect(gross).toBeDefined();
    expect(net).toBeDefined();
    // Door 0.9 × 2.1 = 1.89 m².
    expect(gross!.qty - net!.qty).toBeCloseTo(1.89, 2);
  });

  it("carries gross_qty + opening_refs so the deduction is auditable", () => {
    const net = tilingFor(
      buildPlanGraph({ ...wet, openings: [{ id: "o1", type: "door", position: [0.5, 0.5] }] }),
    )!;
    expect(net.opening_refs).toEqual(["o1"]);
    expect(net.gross_qty).toBeDefined();
    expect(net.gross_qty! - net.qty).toBeCloseTo(1.89, 2);
  });

  it("leaves gross quantities free of provenance fields when nothing deducts", () => {
    const gross = tilingFor(buildPlanGraph(wet))!;
    expect(gross.opening_refs).toBeUndefined();
    expect(gross.gross_qty).toBeUndefined();
  });

  it("sums multiple openings on one element and never goes negative", () => {
    // Three absurdly large windows on the party wall — net must floor at 0,
    // not go negative and silently credit the contractor.
    const g = buildPlanGraph({
      ...wet,
      openings: [
        { id: "o1", type: "window", position: [0.5, 0.2], width_mm: 40_000, height_mm: 40_000 },
        { id: "o2", type: "window", position: [0.5, 0.5], width_mm: 40_000, height_mm: 40_000 },
        { id: "o3", type: "window", position: [0.5, 0.8], width_mm: 40_000, height_mm: 40_000 },
      ],
    });
    const net = tilingFor(g)!;
    expect(net.qty).toBe(0);
    expect(net.opening_refs).toHaveLength(3);
  });

  it("skips unsnapped openings rather than guessing which element loses area", () => {
    // No walls exist without rooms, so build a graph whose opening has no
    // position — it cannot snap, and must not deduct from anything.
    const g = buildPlanGraph({ ...wet, openings: [{ id: "o1", type: "door" }] });
    expect(g.openings[0]!.wall_id).toBeNull();
    const net = tilingFor(g)!;
    const gross = tilingFor(buildPlanGraph(wet))!;
    expect(net.qty).toBe(gross.qty);
    expect(net.opening_refs).toBeUndefined();
  });

  it("measures demolition GROSS — you still strip the full wall", () => {
    const withOpening = buildPlanGraph({
      ...wet,
      openings: [{ id: "o1", type: "door", position: [0.5, 0.5] }],
    });
    const wallId = withOpening.openings[0]!.wall_id!;
    // Demolition needs a proposed graph that drops the wall; use an empty one.
    const demo = quantifyPlan(withOpening, {
      proposed: { ...withOpening, walls: [] },
    }).find((i) => i.work_item_key === "demolition" && i.element_id === wallId);
    const plaster = quantifyPlan(withOpening).find(
      (i) => i.work_item_key === "wall_plaster" && i.element_id === wallId,
    );
    expect(demo).toBeDefined();
    expect(demo!.qty).toBeGreaterThan(plaster!.qty);
    expect(demo!.opening_refs).toBeUndefined();
  });
});

describe("deriveWallSegments — editor and engine agree on walls (A5)", () => {
  it("returns the same ids and count buildPlanGraph prices", () => {
    const g = buildPlanGraph(wet);
    const segs = deriveWallSegments(wet.rooms.map((r) => ({ id: r.id, polygon: r.polygon })));
    expect(segs.map((s) => s.id)).toEqual(g.walls.map((w) => w.id));
    expect(segs.map((s) => s.roomIds)).toEqual(g.walls.map((w) => w.room_ids));
  });

  it("places an opening added at a wall midpoint back on that same wall", () => {
    const segs = deriveWallSegments(wet.rooms.map((r) => ({ id: r.id, polygon: r.polygon })));
    const party = segs.find((s) => s.roomIds.length === 2)!;
    // What the editor persists when you add to the selected wall.
    const mid: [number, number] = [
      (party.a[0] + party.b[0]) / 2,
      (party.a[1] + party.b[1]) / 2,
    ];
    const g = buildPlanGraph({ ...wet, openings: [{ id: "o1", type: "door", position: mid }] });
    // The graph re-snaps by position; it must land on the wall the user picked.
    expect(g.openings[0]!.wall_id).toBe(party.id);
  });
});

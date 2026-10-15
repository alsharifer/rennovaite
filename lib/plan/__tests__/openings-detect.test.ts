// R10b — openings found on the drawing: snapping, the once-per-plan run, the
// "derived until confirmed" rule on the plan graph, the revision cause, and
// what an off-plan render is told.

import { Resvg } from "@resvg/resvg-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/firms/__tests__/fake-db";
import { summarizeChanges } from "@/lib/boq/changes-since";
import { loadRecordedCauses } from "@/lib/boq/revision-causes";
import { buildOffplanBasePrompt } from "@/lib/render-prompts";
import { editOpeningsClause, openingsBasis, openingsPhrase, roomOpeningsFor } from "@/lib/render/openings-prompt";

import { buildPlanGraph } from "@/lib/plan/geometry";
import { assembleMappedSections } from "@/lib/boq/elements";
import { quantifyPlan } from "@/lib/boq/quantify";

import { drawingFrame, mergeAdjacentProposals, normaliseProposals, overlaySvg, runOpeningsDetection, snapProposals, unitToMetres, type DetectRoom, type Drawing, type Proposal } from "../openings-detect";
import { isUnconfirmedDetected, openingWidthLabel, openingsSentence, renderOpeningsLabel, widthsToCheck, DETECTED_RENDER_LABEL } from "../openings-vocab";

let db: FakeDb;
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdmin: () => db.client }));
const { derivePlanGraph } = await import("../derive");

// Dining 4 × 5 m beside a kitchen 3 × 5 m (10 m per normalised unit).
const DINING = "11111111-1111-4111-8111-111111111111";
const KITCHEN = "22222222-2222-4222-8222-222222222222";
const ROOMS: DetectRoom[] = [
  { id: DINING, name: "Dining room", room_type: "dining", polygon: [[0.1, 0.1], [0.5, 0.1], [0.5, 0.6], [0.1, 0.6]], area_m2: 20 },
  { id: KITCHEN, name: "Kitchen", room_type: "kitchen", polygon: [[0.5, 0.1], [0.8, 0.1], [0.8, 0.6], [0.5, 0.6]], area_m2: 15 },
];
const U = unitToMetres(ROOMS, 35);

const P = (p: Partial<Proposal> & Pick<Proposal, "kind" | "room" | "side" | "start" | "end">): Proposal => ({ opens_to: "unknown", confidence: 0.8, ...p });
const PROPOSALS: Proposal[] = [
  P({ kind: "window", room: "R1", opens_to: "outside", side: "left", start: 0.3, end: 0.7, floor_to_ceiling: true, confidence: 0.9 }),
  P({ kind: "archway", room: "R1", opens_to: "R2", side: "right", start: 0.4, end: 0.7, confidence: 0.85 }),
  P({ kind: "archway", room: "R2", opens_to: "R1", side: "left", start: 0.42, end: 0.68, confidence: 0.6 }),
  P({ kind: "door", room: "R1", side: "bottom", start: 0.4, end: 0.6 }),
  P({ kind: "door", room: "R9", side: "left", start: 0.2, end: 0.3 }),
  P({ kind: "window", room: "R1", opens_to: "outside", side: "top", start: 0.25, end: 0.5, confidence: 0.7 }),
];

describe("snapProposals", () => {
  it("puts proposals on the room's walls, sized at the plan's scale", () => {
    expect(U).toBeCloseTo(10, 6);
    const { openings, dropped } = snapProposals(PROPOSALS, ROOMS, U);
    expect(openings).toHaveLength(4);
    expect(openings.find((o) => o.kind === "door")).toMatchObject({ width_mm: 800, position: [0.3, 0.6] });
    const ftc = openings.find((o) => o.detection.floor_to_ceiling)!;
    expect(ftc).toMatchObject({ kind: "window", room_id: DINING, width_mm: 2000, height_mm: 2600, sill_mm: 0, position: [0.1, 0.35] });
    expect(ftc.detection.opens_to).toBe("outside");
    const top = openings.find((o) => o.kind === "window" && !o.detection.floor_to_ceiling)!;
    expect(top).toMatchObject({ width_mm: 1000, height_mm: 1200, sill_mm: 900 });
    // The party-wall passage, seen from both rooms, is ONE opening: the surer reading wins.
    const passage = openings.find((o) => o.kind === "archway")!;
    expect(passage).toMatchObject({ room_id: DINING, width_mm: 1500 });
    expect(passage.detection).toMatchObject({ opens_to: "room", opens_to_room_id: KITCHEN, confidence: 0.85 });
    expect(dropped.map((d) => d.reason).sort()).toEqual(["no room R9", "same opening seen twice"]);
  });

  it("a window read as external stays external on a wall the app thinks is shared", () => {
    const { openings } = snapProposals([P({ kind: "window", room: "R1", opens_to: "outside", side: "right", start: 0.1, end: 0.3 })], ROOMS, U);
    expect(openings[0]!.detection).toMatchObject({ opens_to: "outside", opens_to_room_id: null });
  });

  it("drops a find that lands on an opening already on the plan", () => {
    const { openings, dropped } = snapProposals(PROPOSALS, ROOMS, U, { existing: [{ position: [0.25, 0.1], width_mm: 900 }] });
    expect(openings).toHaveLength(3);
    expect(dropped.some((d) => d.reason === "already on the plan")).toBe(true);
  });

  it("clamps an implausible width and keeps it on the wall", () => {
    const { openings } = snapProposals([P({ kind: "door", room: "R1", side: "left", start: 0, end: 1 })], ROOMS, U);
    expect(openings[0]!.width_mm).toBe(2400);
    expect(openings[0]!.along_offset).toBeGreaterThanOrEqual(0.24 - 1e-9);
  });
});

describe("split glazing (R10b follow-up)", () => {
  it("merges readings of the same kind end to end on one side across a mullion gap", () => {
    const parts = [
      P({ kind: "window", room: "R1", opens_to: "outside", side: "top", start: 0.1, end: 0.4, confidence: 0.6, floor_to_ceiling: true }),
      P({ kind: "window", room: "R1", opens_to: "outside", side: "top", start: 0.42, end: 0.8, confidence: 0.7 }),
    ];
    const merged = mergeAdjacentProposals(parts, ROOMS, U);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ start: 0.1, end: 0.8, merged_from: 2, floor_to_ceiling: true, confidence: 0.7 });
    const { openings } = snapProposals(parts, ROOMS, U);
    expect(openings).toHaveLength(1);
    expect(openings[0]).toMatchObject({ kind: "window", width_mm: 2800, height_mm: 2600 });
    expect(openings[0]!.detection).toMatchObject({ merged_from: 2, width_source: "estimated" });
    // Without the merge the same reading is two windows (the before of the accuracy report).
    expect(snapProposals(parts, ROOMS, U, { merge: false }).openings).toHaveLength(2);
  });

  it("never merges a door with a window, or parts a real wall apart", () => {
    expect(mergeAdjacentProposals([P({ kind: "window", room: "R1", side: "top", start: 0.1, end: 0.4 }), P({ kind: "door", room: "R1", side: "top", start: 0.42, end: 0.6 })], ROOMS, U)).toHaveLength(2);
    // 0.2 of a 4 m side = 0.8 m of wall between them — two windows.
    expect(mergeAdjacentProposals([P({ kind: "window", room: "R1", side: "top", start: 0.1, end: 0.3 }), P({ kind: "window", room: "R1", side: "top", start: 0.5, end: 0.7 })], ROOMS, U)).toHaveLength(2);
  });
});

describe("widths: confirm fixes position and kind, never the width", () => {
  it("a width printed on the drawing is measured; an estimated one is derived", () => {
    const { openings } = snapProposals([P({ kind: "window", room: "R1", side: "top", start: 0.25, end: 0.5, printed_width_mm: 1800 }), P({ kind: "door", room: "R1", side: "bottom", start: 0.4, end: 0.6, printed_width_mm: 40 })], ROOMS, U);
    expect(openings.find((o) => o.kind === "window")).toMatchObject({ width_mm: 1800, detection: { width_source: "printed" } });
    // An implausible printed figure is ignored, never used.
    expect(openings.find((o) => o.kind === "door")).toMatchObject({ width_mm: 800, detection: { width_source: "estimated" } });
  });

  it("the panel says ≈ width — check until it is measured", () => {
    expect(openingWidthLabel({ width_mm: 1800, derived: true })).toEqual({ text: "≈ 1.80 m — check", derived: true });
    expect(openingWidthLabel({ width_mm: 1800, derived: false })).toEqual({ text: "1.80 m", derived: false });
    const rows = [
      { id: "a", kind: "window", room_id: DINING, source: "detected", confirmed_at: "x", derived: true },
      { id: "b", kind: "window", room_id: DINING, source: "detected", confirmed_at: "x", derived: false },
      { id: "c", kind: "window", room_id: DINING, source: "detected", confirmed_at: null, derived: true },
    ];
    expect(widthsToCheck(rows).map((r) => r.id)).toEqual(["a"]);
  });

  it("a wall line net of an opening with a derived width carries the derived mark", () => {
    const graph = (derived: boolean) =>
      buildPlanGraph({
        projectId: "p",
        planId: "pl",
        scale: "1:100",
        total_area_m2: 35,
        rooms: ROOMS.map((r) => ({ id: r.id, name_en: r.name, name_ar: null, room_type: r.room_type, area_m2: r.area_m2, polygon: r.polygon })),
        openings: [{ id: "w1", type: "window", position: [0.1, 0.35], width_mm: 2000, height_mm: 2600, sill_mm: 0, source: "detected", derived }],
      });
    const line = (derived: boolean) => assembleMappedSections(quantifyPlan(graph(derived))).flatMap((s) => s.lines).find((l) => l.work_item_key === "wall_plaster")!;
    expect(line(true)).toMatchObject({ qty_derived: true });
    expect(line(true).notes).toContain("1 of these opening sizes is derived");
    expect(line(false).qty_derived).toBeUndefined();
    // The quantity itself does not depend on the flag.
    expect(line(true).quantity).toBe(line(false).quantity);
  });
});

describe("the drawing frame", () => {
  it("relates polygons saved in the editor viewBox to the drawing through the original reading", () => {
    // The editor fits the rooms into 1000 × 600 (uniformly) and saves that.
    const toView = ([x, y]: [number, number]): [number, number] => [24 + (x - 0.1) * 1600, 24 + (y - 0.1) * 1600];
    const stored = ROOMS.map((r) => ({ ...r, polygon: r.polygon.map(toView) }));
    const frame = drawingFrame(stored, { rooms: ROOMS.map((r) => ({ name_en: r.name, polygon: r.polygon })) })!;
    expect(frame).toMatchObject({ kind: "matched", pairs: 2 });
    expect(frame.rms).toBeLessThan(1e-6);
    // Without names to match on, the two extents.
    expect(drawingFrame(stored, { rooms: ROOMS.map((r) => ({ polygon: r.polygon })) })).toMatchObject({ kind: "parse_bbox", skew: 0 });
    const back = frame.toDrawing(stored[0]!.polygon[2]!);
    expect(back[0]).toBeCloseTo(0.5, 9);
    expect(back[1]).toBeCloseTo(0.6, 9);
    expect(frame.fromDrawing([0.5, 0.6])[0]).toBeCloseTo(stored[0]!.polygon[2]![0], 6);
    // Snapping happens in the stored frame, in metres: the same proposals, the same openings.
    const u = unitToMetres(stored, 35);
    // Side-relative answers need no mapping: the same proposals give the same openings on the stored rooms.
    const viaView = snapProposals(PROPOSALS, stored, u);
    expect(viaView.openings.map((o) => [o.kind, o.width_mm])).toEqual(snapProposals(PROPOSALS, ROOMS, U).openings.map((o) => [o.kind, o.width_mm]));
  });

  it("identity for polygons already in 0–1; nothing to relate them to → null", () => {
    expect(drawingFrame(ROOMS, null)!.kind).toBe("identity");
    // A fresh reading a little past its crop (1.05 seen live) is still the drawing's frame.
    expect(drawingFrame([{ polygon: [[0.16, 0.22], [0.88, 0.22], [0.88, 1.05], [0.16, 1.05]] }], null)!.kind).toBe("identity");
    expect(drawingFrame(ROOMS.map((r) => ({ polygon: r.polygon.map(([x, y]) => [x * 1000, y * 1000] as [number, number]) })), null)).toBeNull();
  });

  it("fractions given as percentages are read back as 0–1", () => {
    const pc = normaliseProposals([P({ kind: "window", room: "R1", side: "top", start: 25, end: 50 })]);
    expect([pc[0]!.start, pc[0]!.end]).toEqual([0.25, 0.5]);
    expect(normaliseProposals(PROPOSALS)).toEqual(PROPOSALS);
  });

  it("an L-shaped room: the outermost wall on that side that covers the opening", () => {
    const L: DetectRoom = { id: "l", name: "Hall", room_type: "foyer", polygon: [[0, 0], [0.4, 0], [0.4, 0.2], [0.3, 0.2], [0.3, 0.4], [0, 0.4]], area_m2: 2 };
    const { openings } = snapProposals(
      [P({ kind: "window", room: "R1", side: "right", start: 0.1, end: 0.3 }), P({ kind: "door", room: "R1", side: "right", start: 0.7, end: 0.9 })],
      [L],
      10,
    );
    expect(openings.map((o) => o.position[0])).toEqual([0.4, 0.3]);
  });
});

describe("the confirmation sentence", () => {
  it("names what was found: We found 2 windows, a door and an opening to the kitchen — correct?", () => {
    const { openings } = snapProposals(PROPOSALS, ROOMS, U);
    const rows = openings.map((o, i) => ({ id: `o${i}`, kind: o.kind, room_id: o.room_id, source: "detected", confirmed_at: null, detection: o.detection }));
    const name = (id: string) => ROOMS.find((r) => r.id === id)?.name ?? null;
    expect(openingsSentence(rows, name)).toBe("We found 2 windows, a door and an opening to the kitchen — correct?");
    // Confirmed ones are no longer asked about.
    expect(openingsSentence(rows.map((r) => ({ ...r, confirmed_at: "2026-10-14T10:00:00Z" })), name)).toBeNull();
  });
});

// A plain 200 × 150 PNG stands in for the rasterised drawing.
function blankDrawing(): Drawing {
  const png = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="200" height="150" fill="#fff"/></svg>`).render().asPng();
  return { bytes: Buffer.from(png), mime: "image/png", width: 200, height: 150, frame: "page" };
}

describe("overlaySvg", () => {
  it("labels the rooms R1…Rn in the polygons' frame", () => {
    const svg = overlaySvg({ width: 200, height: 150, mime: "image/png" }, "data:x", ROOMS, true);
    expect(svg).toContain(">R1<");
    expect(svg).toContain(">R2<");
    expect(svg).toContain(`points="20.0,15.0 100.0,15.0 100.0,90.0 20.0,90.0"`);
    expect(overlaySvg({ width: 200, height: 150, mime: "image/png" }, "data:x", ROOMS, false)).not.toContain("R1");
  });
});

const PLAN = "33333333-3333-4333-8333-333333333333";
const PROJECT = "44444444-4444-4444-8444-444444444444";

function seed(extraOpenings: Record<string, unknown>[] = []) {
  db = fakeDb({
    plans: [{ id: PLAN, project_id: PROJECT, pdf_url: "https://example.test/plan.pdf", parsed_json: { scale: "1:100" }, total_area_m2: 35, source: "parsed", openings_detected_at: null, openings_detection: null, created_at: "2026-10-01T00:00:00Z" }],
    rooms: ROOMS.map((r) => ({ id: r.id, plan_id: PLAN, name_en: r.name, room_type: r.room_type, polygon: r.polygon, area_m2: r.area_m2 })),
    plan_openings: extraOpenings,
  });
}

const ask = vi.fn(async () => JSON.stringify({ openings: PROPOSALS }));
const deps = { ask, drawing: async () => blankDrawing(), now: () => new Date("2026-10-14T09:00:00Z") };

describe("runOpeningsDetection", () => {
  beforeEach(() => ask.mockClear());

  it("runs once automatically, writes derived 'detected' rows, and keeps what nobody may lose", async () => {
    seed([
      { id: "stale", plan_id: PLAN, kind: "door", source: "detected", confirmed_at: null, position: [0.8, 0.3], width_mm: 900 },
      { id: "kept", plan_id: PLAN, kind: "door", source: "detected", confirmed_at: "2026-10-13T00:00:00Z", position: [0.65, 0.6], width_mm: 900 },
      { id: "drawn", plan_id: PLAN, kind: "window", source: "user_drawn", confirmed_at: null, position: [0.25, 0.1], width_mm: 1000 },
    ]);
    const out = await runOpeningsDetection(db.client, PLAN, "auto", deps);
    expect(out).toEqual({ status: "done", found: 3, dropped: 3 });
    const rows = db.tables.plan_openings!;
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining(["kept", "drawn"]));
    expect(rows.find((r) => r.id === "stale")).toBeUndefined();
    const found = rows.filter((r) => r.source === "detected" && !r.confirmed_at);
    expect(found).toHaveLength(3);
    for (const r of found) expect(r).toMatchObject({ derived: true, plan_id: PLAN });
    expect(db.tables.plans![0]).toMatchObject({ openings_detected_at: "2026-10-14T09:00:00.000Z", openings_detection: { status: "done", found: 3, dropped: 3, mode: "auto" } });

    // Once per plan: a second automatic run does nothing (no model call).
    expect(await runOpeningsDetection(db.client, PLAN, "auto", deps)).toMatchObject({ status: "already" });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("Re-detect replaces only the unconfirmed finds", async () => {
    seed();
    await runOpeningsDetection(db.client, PLAN, "auto", deps);
    const first = db.tables.plan_openings!.filter((r) => r.source === "detected");
    first[0]!.confirmed_at = "2026-10-14T09:30:00Z";
    await runOpeningsDetection(db.client, PLAN, "redetect", { ...deps, now: () => new Date("2026-10-14T10:00:00Z") });
    const after = db.tables.plan_openings!;
    expect(after.find((r) => r.id === first[0]!.id)).toBeDefined();
    // The confirmed one is not found twice; the others are fresh rows.
    expect(after).toHaveLength(4);
    expect(after.filter((r) => !r.confirmed_at).every((r) => !first.some((f) => f.id === r.id))).toBe(true);
  });

  it("an authored plan, or one with no drawing, has nothing to read", async () => {
    seed();
    db.tables.plans![0]!.pdf_url = null;
    expect(await runOpeningsDetection(db.client, PLAN, "auto", deps)).toEqual({ status: "no_drawing" });
    expect(ask).not.toHaveBeenCalled();
    expect(db.tables.plans![0]!.openings_detection).toMatchObject({ status: "no_drawing" });
  });

  it("a reply that is not the schema twice fails the run and writes nothing", async () => {
    seed();
    const bad = vi.fn(async () => "not json");
    expect(await runOpeningsDetection(db.client, PLAN, "auto", { ...deps, ask: bad })).toMatchObject({ status: "failed" });
    expect(bad).toHaveBeenCalledTimes(2);
    expect(db.tables.plan_openings ?? []).toHaveLength(0);
    expect(db.tables.plans![0]!.openings_detection).toMatchObject({ status: "failed" });
  });
});

describe("derived until confirmed (derivePlanGraph)", () => {
  it("leaves an unconfirmed find out of every pricing path; a render may ask for it, labelled", async () => {
    seed([
      { id: "u", plan_id: PLAN, kind: "window", source: "detected", confirmed_at: null, derived: true, position: [0.1, 0.35], width_mm: 2000, height_mm: 2600, sill_mm: 0 },
      { id: "c", plan_id: PLAN, kind: "door", source: "detected", confirmed_at: "2026-10-14T00:00:00Z", derived: false, position: [0.3, 0.6], width_mm: 900, height_mm: 2100, sill_mm: 0 },
      { id: "d", plan_id: PLAN, kind: "window", source: "user_drawn", confirmed_at: null, derived: true, position: [0.25, 0.1], width_mm: 1200, height_mm: 1200, sill_mm: 900 },
    ]);
    const priced = await derivePlanGraph(PROJECT);
    expect(priced.openings.map((o) => o.id).sort()).toEqual(["c", "d"]);
    expect(priced.openings.find((o) => o.id === "c")).toMatchObject({ source: "detected", derived: false });
    const forRender = await derivePlanGraph(PROJECT, { includeUnconfirmed: true });
    expect(forRender.openings.map((o) => o.id).sort()).toEqual(["c", "d", "u"]);
    expect(forRender.openings.find((o) => o.id === "u")).toMatchObject({ unconfirmed: true, source: "detected" });
    expect(forRender.openings.find((o) => o.id === "c")!.unconfirmed).toBeUndefined();
  });
});

describe("Openings confirmed — the revision cause", () => {
  it("a confirmation after rev N makes the BoQ stale and explains the wall lines", async () => {
    db = fakeDb({
      pilot_events: [
        { project_id: PROJECT, kind: "design_edit", recorded_at: "2026-10-14T10:00:00Z", detail: { layer: "openings_confirmed", count: 3 } },
        { project_id: PROJECT, kind: "design_edit", recorded_at: "2026-10-14T10:05:00Z", detail: { layer: "openings_confirmed", count: 1, adjusted: true } },
      ],
    });
    const causes = await loadRecordedCauses(db.client, PROJECT, "2026-10-14T09:00:00Z", "2026-10-14T11:00:00Z", "");
    const c = causes.find((x) => x.kind === "openings_confirmed")!;
    expect(c.summary).toBe("Openings confirmed — 4 openings");
    expect(c.item_keys).toEqual(["wall_plaster", "wall_paint", "wet_tiling"]);
    expect(summarizeChanges(causes, 4)).toMatchObject({ openingsConfirmed: 1, changed: true, summary: "Openings confirmed since rev 4" });
  });

  it("unconfirmed finds are not a change", () => {
    expect(summarizeChanges([], 4).changed).toBe(false);
    expect(isUnconfirmedDetected({ source: "detected", confirmed_at: null })).toBe(true);
    expect(isUnconfirmedDetected({ source: "user_drawn", confirmed_at: null })).toBe(false);
  });
});

describe("what an off-plan render is told", () => {
  const name = (id: string) => ROOMS.find((r) => r.id === id)?.name ?? null;
  const rows = [
    { id: "w1", kind: "window", room_id: DINING, source: "detected", confirmed_at: null, detection: { floor_to_ceiling: true, opens_to: "outside" as const } },
    { id: "w2", kind: "window", room_id: DINING, source: "detected", confirmed_at: null, detection: { floor_to_ceiling: true, opens_to: "outside" as const } },
    { id: "a1", kind: "archway", room_id: DINING, source: "detected", confirmed_at: "2026-10-14T00:00:00Z", detection: { opens_to_room_id: KITCHEN, opens_to: "room" as const } },
    { id: "k1", kind: "window", room_id: KITCHEN, source: "user_drawn", confirmed_at: null, detection: null },
  ];

  it("the dining room: its windows and the passage to the kitchen", () => {
    const dining = roomOpeningsFor(rows, DINING);
    expect(dining.map((o) => o.id)).toEqual(["w1", "w2", "a1"]);
    expect(openingsPhrase(dining, DINING, name)).toBe("two floor-to-ceiling windows and a wide open passage to the kitchen");
    expect(openingsBasis(dining)).toEqual({ confirmed: 1, detected: 2, ids: ["w1", "w2", "a1"] });
    expect(renderOpeningsLabel(openingsBasis(dining))).toBe(DETECTED_RENDER_LABEL);
  });

  it("the kitchen sees the same passage from its side", () => {
    const kitchen = roomOpeningsFor(rows, KITCHEN);
    expect(openingsPhrase(kitchen, KITCHEN, name)).toBe("a window and a wide open passage to the dining room");
  });

  it("a room with no openings keeps its prompt byte-identical", () => {
    const before = buildOffplanBasePrompt({ roomType: "living", widthM: 4, depthM: 5 });
    expect(buildOffplanBasePrompt({ roomType: "living", widthM: 4, depthM: 5, openings: null })).toBe(before);
    expect(before).toContain("a single window on one side wall");
    const withOpenings = buildOffplanBasePrompt({ roomType: "living", widthM: 4, depthM: 5, openings: "two floor-to-ceiling windows" });
    expect(withOpenings).toContain("with exactly two floor-to-ceiling windows and no other openings");
    expect(withOpenings).not.toContain("single window");
    expect(editOpeningsClause("a door")).toContain("the room has exactly a door");
    expect(renderOpeningsLabel(null)).toBeNull();
  });
});

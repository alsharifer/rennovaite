import { describe, expect, it } from "vitest";

import { quantifyPlan } from "@/lib/boq/quantify";
import { DEFAULT_FOOTPRINT_MM, footprintOf, snapToWall } from "@/lib/overlays/footprint";
import { buildPlanGraph, deriveWallSegments, type RawOpening } from "@/lib/plan/geometry";
import { checkPlan, hardProblemFor, type RuleOpening } from "@/lib/plan/plan-rules";
import { openingDefaultsFor, parseIntakeDraft, roomFromDimensions, ROOM_INTAKE_OPENING_DIMS } from "@/lib/plan/room-intake";
import { DEFAULT_OPENING_DIMS } from "@/lib/plan/geometry";

// =============================================================================
// B1 — the pilot bathroom, from its room sheet (data/Bathroom Pilot/
// Bathroom_Pilot_Room_Sheet.md, 18 Oct; client files stay out of git, so the
// numbers the acceptance turns on are restated here). Coordinates in cm from the
// NW corner, x east, y south.
//
//   room     266 (x) × 263 (y) × 280 high, all measured
//   door     S wall, x 118–205 (87 incl. frame), ~210 high
//   window   W wall, y 28–73 (45 wide), ~60 high, sill ~150
//   fixtures shower NE corner x 125–266 y 0–91 · WC centre (33, 121), 42 wide,
//            12 + 54 deep · bidet (28, 212), 36 × 48 · vanity on the E wall,
//            x 212–266 y 176–263 · floor drain (120, 110)
//   §8       floor 7.00 m²; wall tiling = 10.58 × 2.80 − 0.87 × 2.10 − 0.45 × 0.60 ≈ 27.5 m²
// =============================================================================

const L = 2.66;
const n = (xCm: number, yCm: number): [number, number] => [xCm / 100 / L, yCm / 100 / L];

const ROOM = roomFromDimensions({ room_type: "bathroom", length_m: 2.66, width_m: 2.63, height_m: 2.8 });
const RAW_ROOM = { id: "bath", name_en: ROOM.name_en, name_ar: null, room_type: ROOM.room_type, area_m2: ROOM.area_m2, polygon: ROOM.polygon, unroofed: false, ceiling_h_m: ROOM.ceiling_h_m, ceiling_h_source: "measured" };

const DOOR: RawOpening = { id: "door", room_id: "bath", type: "door", width_mm: 870, height_mm: 2100, sill_mm: 0, position: n((118 + 205) / 2, 263), derived: false };
const WINDOW: RawOpening = { id: "window", room_id: "bath", type: "window", width_mm: 450, height_mm: 600, sill_mm: 1500, position: n(0, (28 + 73) / 2), derived: false };

/** The same openings as the plan rules read them. */
const asRule = (o: RawOpening): RuleOpening => ({ id: o.id, kind: o.type as RuleOpening["kind"], width_mm: o.width_mm ?? null, height_mm: o.height_mm ?? null, sill_mm: o.sill_mm ?? null, position: o.position, room_id: o.room_id ?? null });

const graphOf = (openings: RawOpening[] = [DOOR, WINDOW], room: Record<string, unknown> = RAW_ROOM) =>
  buildPlanGraph({
    projectId: "pilot",
    planId: "plan",
    scale: null,
    total_area_m2: ROOM.area_m2,
    rooms: [room as never],
    openings,
    unit_to_m: L,
    plot: { width_m: ROOM.length_m, depth_m: ROOM.width_m },
    source: "user_drawn",
  });

describe("B1 — one room from its dimensions (the pilot bathroom)", () => {
  it("the room: 2.66 × 2.63 polygon, floor 7.00 m², every entered value measured", () => {
    expect(ROOM.area_m2).toBe(7);
    expect(ROOM.polygon).toEqual([[0, 0], [1, 0], [1, 2.63 / 2.66], [0, 2.63 / 2.66]]);
    const g = graphOf([]);
    const r = g.rooms[0]!;
    expect(r.ceiling_h_m).toBe(2.8);
    expect(r.ceiling_h_source).toBe("measured");
    expect(r.derived_fields).toEqual([]);
    expect(g.derived.ceiling_h).toBe(false);
    expect(g.derived.metric_scale).toBe(false);
    // The metric outline is the room as typed, to the mm.
    const xs = r.polygon.map((p) => p[0]), ys = r.polygon.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2.66, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2.63, 6);
  });

  it("§8: floor 7.00 m² and wall tiling ≈ 27.5 m² net of the door and window, at the measured 2.80 m", () => {
    const g = graphOf();
    expect(g.openings.every((o) => o.wall_id)).toBe(true);
    const items = quantifyPlan(g);
    const floor = items.find((i) => i.work_item_key === "floor_finish")!;
    const tiling = items.find((i) => i.work_item_key === "wet_tiling")!;
    expect(floor.qty).toBe(7);
    // 10.58 × 2.80 − 0.87 × 2.10 − 0.45 × 0.60 = 29.624 − 1.827 − 0.27 = 27.527
    expect(tiling.gross_qty).toBe(29.62);
    expect(tiling.qty).toBe(27.53);
    expect(tiling.opening_refs?.sort()).toEqual(["door", "window"]);
    // Measured openings: nothing on the line is derived.
    expect(tiling.derived_opening_refs).toBeUndefined();
    // At the old 2.9 m default the same room would read ~3.5 % more.
    const at29 = quantifyPlan(graphOf(undefined, { ...RAW_ROOM, ceiling_h_m: null, ceiling_h_source: null })).find((i) => i.work_item_key === "wet_tiling")!;
    expect(at29.qty).toBe(28.58); // 30.682 − 2.097
    expect(at29.qty / tiling.qty).toBeCloseTo(1.038, 3);
  });

  it("the plan check is green: no plan-rule violation, hard or soft", () => {
    const { violations, needsWall } = checkPlan({ rooms: [RAW_ROOM], openings: [asRule(DOOR), asRule(WINDOW)], mPerU: L });
    expect(violations).toEqual([]);
    expect(needsWall.size).toBe(0);
  });

  it("the plan rules read the room's own ceiling: a door taller than 2.80 m is refused there", () => {
    const tall = { ...asRule(DOOR), height_mm: 2850 };
    expect(hardProblemFor(tall, [], [RAW_ROOM], L)?.rule).toBe("height");
    expect(hardProblemFor(tall, [], [{ ...RAW_ROOM, ceiling_h_m: null }], L)).toBeNull();
  });

  it("a room-from-dimensions plan starts doors at 0.8 m and windows at 0.6 × 1.2 m on a 1.2 m sill; every other plan is unchanged", () => {
    expect(openingDefaultsFor(DEFAULT_OPENING_DIMS, "door", "room_dimensions")).toEqual(ROOM_INTAKE_OPENING_DIMS.door);
    expect(ROOM_INTAKE_OPENING_DIMS.door.width_mm).toBe(800);
    expect(ROOM_INTAKE_OPENING_DIMS.window).toEqual({ width_mm: 600, height_mm: 1200, sill_mm: 1200 });
    expect(openingDefaultsFor(DEFAULT_OPENING_DIMS, "door", null)).toEqual(DEFAULT_OPENING_DIMS.door);
    expect(openingDefaultsFor(DEFAULT_OPENING_DIMS, "archway", "room_dimensions")).toEqual(DEFAULT_OPENING_DIMS.archway);
  });

  it("the form parses to 2 dp and says why Continue is disabled", () => {
    expect(parseIntakeDraft({ length: "2.664", width: "2.63", height: "2.8" })).toEqual({ ok: true, length_m: 2.66, width_m: 2.63, height_m: 2.8 });
    expect(parseIntakeDraft({ length: "", width: "2.63", height: "2.8" })).toMatchObject({ ok: false });
    expect(parseIntakeDraft({ length: "2.66", width: "2.63", height: "9" })).toMatchObject({ ok: false, reason: expect.stringMatching(/ceiling/i) });
  });
});

describe("B1 — fixtures with a footprint, snapped to their wall (§3)", () => {
  const walls = deriveWallSegments([{ id: "bath", polygon: ROOM.polygon, room_type: "bathroom" }]);
  const snap = (type: string, cx: number, cy: number, spec: Record<string, unknown>) => snapToWall({ type, position: n(cx, cy), room_id: "bath", spec }, walls, L)!;
  const cm = (p: [number, number]) => [Math.round(p[0] * L * 1000) / 10, Math.round(p[1] * L * 1000) / 10];

  it("every footprint type has a default; points (a floor drain) have none", () => {
    expect(DEFAULT_FOOTPRINT_MM).toEqual({
      wc_point: { width_mm: 400, depth_mm: 700 },
      bidet_point: { width_mm: 400, depth_mm: 550 },
      basin_point: { width_mm: 900, depth_mm: 600 },
      shower_mixer: { width_mm: 900, depth_mm: 900 },
      bath_point: { width_mm: 1700, depth_mm: 750 },
      storage_cabinet: { width_mm: 400, depth_mm: 450 },
    });
    expect(footprintOf("floor_drain", null)).toBeNull();
    expect(footprintOf("bath_point", null)).toMatchObject({ width_mm: 1700, depth_mm: 750, footprint: "default" });
  });

  it("the sheet's fixtures land at the sheet's centres, backed onto their walls, facing into the room", () => {
    const wc = snap("wc_point", 33, 121, { width_mm: 420, depth_mm: 660, footprint: "entered" });
    expect(cm(wc.position)).toEqual([33, 121]);
    expect(wc.spec.rotation_deg).toBe(90); // W wall, facing east
    const bidet = snap("bidet_point", 28, 212, { width_mm: 360, depth_mm: 480, wall_gap_mm: 40, footprint: "entered" });
    expect(cm(bidet.position)).toEqual([28, 212]);
    expect(bidet.spec.rotation_deg).toBe(90);
    const vanity = snap("basin_point", 239, 219.5, { width_mm: 870, depth_mm: 540, footprint: "entered" });
    expect(cm(vanity.position)).toEqual([239, 219.5]);
    expect(vanity.spec.rotation_deg).toBe(270); // E wall, facing west
    const shower = snap("shower_mixer", 195.5, 45.5, { width_mm: 1410, depth_mm: 910, footprint: "entered" });
    expect(cm(shower.position)).toEqual([195.5, 45.5]);
    expect(shower.spec.rotation_deg).toBe(180); // N wall, facing south
    // The wall reference is filled in, and it is the wall the fixture backs onto.
    for (const f of [wc, bidet, vanity, shower]) expect(walls.map((w) => w.id)).toContain(f.wall_id);
    expect(new Set([wc.wall_id, bidet.wall_id]).size).toBe(1);
    expect(new Set([wc.wall_id, vanity.wall_id, shower.wall_id]).size).toBe(3);
  });

  it("a dropped fixture is pulled flush to the wall and kept on it", () => {
    // A default WC dropped 40 cm off the W wall: its back goes to the wall face.
    const wc = snap("wc_point", 75, 121, {});
    expect(cm(wc.position)).toEqual([35, 121]);
    expect(wc.spec).toMatchObject({ width_mm: 400, depth_mm: 700, footprint: "default", rotation_deg: 90 });
    // A 1.7 m bath dropped near the NW corner backs onto the N wall (nearer) and
    // stays wholly on it: its centre is at least half its length from the corner.
    const bath = snap("bath_point", 30, 20, {});
    expect(cm(bath.position)).toEqual([85, 37.5]);
    expect(bath.spec.rotation_deg).toBe(180);
  });
});

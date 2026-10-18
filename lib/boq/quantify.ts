// =============================================================================
// lib/boq/quantify.ts — per-element take-off from the PlanGraph (Prompt P4).
//
// Deterministic: one TakeoffItem per (room × work item) or (wall × work item),
// computed straight from the P1 PlanGraph. This is the ground truth that makes
// element↔BoQ mapping real — the aggregated POMI line's quantity is the SUM
// over these items and its element_refs are their element ids.
//
// `wet_area` is an ATTRIBUTE on the item, not the basis of any split.
// No LLM, no DB, no aggregation — pure geometry. Unit-tested for the invariant
// that per-room sums equal each aggregated line quantity.
// =============================================================================

import type { PlanGraph, Point } from "@/lib/plan/geometry";

export type WorkItemKey =
  | "floor_finish"
  | "ceiling_finish"
  | "wall_plaster"
  | "wall_paint"
  | "wet_tiling"
  | "demolition";

export interface TakeoffItem {
  work_item_key: WorkItemKey;
  room_id: string | null;
  /** The element this quantity belongs to: a room id (floor/ceiling/tiling) or
   *  a wall id (plaster/paint/demolition). */
  element_id: string;
  qty: number;
  unit: string; // "m2"
  wet_area: boolean;
  /** A5: opening ids whose area was deducted from `qty` (gross → net). Present
   *  only on the surface items that deduct — plaster, paint, wet tiling — so
   *  the QS can trace every deduction back to a door/window. Empty/absent means
   *  the quantity is gross because nothing opened onto that element. */
  opening_refs?: string[];
  /** A5: the gross (pre-deduction) area, kept alongside the net `qty` so the
   *  deduction is auditable rather than silent. Absent when nothing deducted. */
  gross_qty?: number;
  /** R10b: the deducted openings whose size is DERIVED (defaulted, or estimated
   *  off the drawing and never edited) — the net quantity rests on them, so the
   *  line carries the derived mark. Absent when every deducted size is measured. */
  derived_opening_refs?: string[];
  /** B5: wall paint only — the wall area NOT painted because it is tiled (a wall
   *  that bounds only wet rooms is painted above their tiled height). */
  tiled_m2?: number;
}

/**
 * B5 (065): how high a room's walls are tiled — the stored value (capped at the
 * ceiling), else the type default: full height for a wet room (what wet_tiling
 * has always measured), none for a dry room. Dry rooms are never tiled here.
 */
export function tiledHeightOf(room: { type: string | null; tiled_height_m?: number }, ceilingH: number): number {
  if (!isWet(room.type)) return 0;
  const t = room.tiled_height_m;
  return typeof t === "number" && t >= 0 ? Math.min(t, ceilingH) : ceilingH;
}

/** The part of an opening inside the wall band [lo, hi] (m²). */
function openingInBand(o: { width_mm: number; height_mm: number; sill_mm: number }, lo: number, hi: number): number {
  const s = (o.sill_mm || 0) / 1000, t = s + (o.height_mm || 0) / 1000;
  return ((o.width_mm || 0) / 1000) * Math.max(0, Math.min(hi, t) - Math.max(lo, s));
}

const WET_ROOM_TYPES = new Set(["bathroom", "ensuite", "powder", "kitchen"]);

/** Outdoor zone tokens — priced by the landscape take-off, never here. */
const OUTDOOR_ZONE_TYPES = new Set([
  "paving",
  "artificial_grass",
  "planting_bed",
  "deck",
  "path",
  "structure",
  "pool",
]);

function isOutdoorType(t: string | null): boolean {
  return OUTDOOR_ZONE_TYPES.has(t ?? "");
}

function isWet(roomType: string | null): boolean {
  return WET_ROOM_TYPES.has(roomType ?? "");
}

function perimeterM(poly: Point[]): number {
  let p = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    p += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return p;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Order-independent geometric key of a wall (0.1 m tol) — matches demo-sheet. */
export function wallKey(polyline: Point[]): string {
  const a = polyline[0];
  const b = polyline[polyline.length - 1];
  if (!a || !b) return "";
  const q = (v: number) => Math.round(v * 10) / 10;
  return [`${q(a[0])},${q(a[1])}`, `${q(b[0])},${q(b[1])}`].sort().join("|");
}

export interface QuantifyOptions {
  /** As-built graph is the default basis; a proposed graph enables demolition. */
  proposed?: PlanGraph | null;
}

/**
 * Compute the per-element take-off for a plan. Rooms → floor/ceiling (+ wet
 * tiling, net of openings); walls → plaster + paint (net of openings); walls
 * present in as-built but absent in proposed → demolition.
 *
 * A5 deduction rule: net = gross − Σ (opening width × height) over the openings
 * on that element, floored at 0. Every deducting item carries `gross_qty` and
 * `opening_refs`, so the deduction is auditable at the line rather than silent.
 * Demolition is measured GROSS on purpose — you still strip the full wall.
 */
export function quantifyPlan(graph: PlanGraph, opts: QuantifyOptions = {}): TakeoffItem[] {
  const items: TakeoffItem[] = [];

  // Ceiling height per room (default 2.9 from P1).
  const ceilingByRoom = new Map<string, number>();
  for (const room of graph.rooms) ceilingByRoom.set(room.id, room.ceiling_h_m || 2.9);
  const globalCeiling =
    graph.rooms.reduce((m, r) => Math.max(m, r.ceiling_h_m || 0), 0) || 2.9;

  // --- Openings (A5): area + ids, keyed by wall and by room ------------------
  //
  // An opening belongs to a WALL, but wet-area tiling is measured per ROOM
  // (perimeter × height). A door between a bathroom and a corridor removes tile
  // from the bathroom face, so an opening deducts from every room its wall
  // borders — each side genuinely loses that surface. Unsnapped openings
  // (wall_id null) are skipped rather than guessed at: an opening we cannot
  // attribute must not silently shrink a quantity.
  const openingArea = (o: (typeof graph.openings)[number]) =>
    ((o.width_mm || 0) * (o.height_mm || 0)) / 1e6;

  const roomIdsByWall = new Map<string, string[]>();
  for (const w of graph.walls) roomIdsByWall.set(w.id, w.room_ids);

  const byWall = new Map<string, { area: number; ids: string[] }>();
  const byRoom = new Map<string, { area: number; ids: string[] }>();
  // B5: the openings themselves, for the part of each inside a tiled / painted band.
  const openingsByRoom = new Map<string, (typeof graph.openings)[number][]>();
  const openingsByWall = new Map<string, (typeof graph.openings)[number][]>();
  // R10b: openings whose size is derived — a quantity net of one is derived too.
  const derivedOpenings = new Set(graph.openings.filter((o) => o.derived).map((o) => o.id));
  const derivedRefs = (ids: string[]) => {
    const d = ids.filter((id) => derivedOpenings.has(id));
    return d.length > 0 ? { derived_opening_refs: d } : {};
  };

  for (const o of graph.openings) {
    if (!o.wall_id) continue; // unsnapped — cannot attribute to a wall
    const area = openingArea(o);
    if (area <= 0) continue;

    const w = byWall.get(o.wall_id) ?? { area: 0, ids: [] };
    w.area += area;
    w.ids.push(o.id);
    byWall.set(o.wall_id, w);

    // Attribute to the wall's rooms; fall back to the opening's own room_id
    // when the wall carries none (boundary wall with an unresolved room).
    const rooms = roomIdsByWall.get(o.wall_id) ?? [];
    const targets = rooms.length > 0 ? rooms : o.room_id ? [o.room_id] : [];
    for (const rid of targets) {
      const r = byRoom.get(rid) ?? { area: 0, ids: [] };
      r.area += area;
      r.ids.push(o.id);
      byRoom.set(rid, r);
      (openingsByRoom.get(rid) ?? openingsByRoom.set(rid, []).get(rid)!).push(o);
    }
    (openingsByWall.get(o.wall_id) ?? openingsByWall.set(o.wall_id, []).get(o.wall_id)!).push(o);
  }

  // K12 (058): a room NOT in this renovation contributes no room-level quantity.
  // It stays on the graph (scale, walls); its floor, ceiling and tiling go, and a
  // wall goes only when no room on either side of it is in scope.
  const inScope = (id: string | null | undefined) => !id || graph.rooms.find((r) => r.id === id)?.in_scope !== false;

  // --- Rooms: floor + ceiling (+ wet tiling) ---
  for (const room of graph.rooms) {
    if (room.in_scope === false) continue;
    // G3: an outdoor zone has no interior floor to finish. Its surface is priced
    // by the landscape take-off (PCC + paving install + tile supply, or grass),
    // and emitting an interior floor_finish line here charged for the same
    // ground twice. `terrace` and `balcony` are NOT outdoor zones and keep the
    // interior treatment they have always had.
    if (isOutdoorType(room.type)) continue;
    const wet = isWet(room.type);
    const h = ceilingByRoom.get(room.id) ?? globalCeiling;
    // Stairs are priced as a developed tile surface in the engine take-off (not
    // flat floor), so exclude them from per-room floor_finish here to avoid
    // double-counting the stair footprint. Ceiling is still emitted.
    if (room.type !== "stairs") {
      items.push({ work_item_key: "floor_finish", room_id: room.id, element_id: room.id, qty: r2(room.area_m2), unit: "m2", wet_area: wet });
    }
    // G1: an unroofed zone has no ceiling to finish. Its ceiling_h_m is 0, so
    // the line would have priced a real area against a surface that does not
    // exist — skip it outright rather than emit a zero.
    if (!room.unroofed) {
      items.push({ work_item_key: "ceiling_finish", room_id: room.id, element_id: room.id, qty: r2(room.area_m2), unit: "m2", wet_area: wet });
    }
    const th = tiledHeightOf(room, h);
    if (wet && th > 0) {
      // Wet-wall tiling: room perimeter × the tiled height (B5 — full height by
      // default, the ceiling), NET of the part of every door/window opening onto
      // this room that falls in the tiled band (A5). Floored at 0. At full height
      // the band is the whole wall: the pre-B5 formula, unchanged.
      const ded = byRoom.get(room.id);
      const full = th >= h - 1e-9;
      const gross = perimeterM(room.polygon) * (full ? h : th);
      const cut = full ? (ded?.area ?? 0) : (openingsByRoom.get(room.id) ?? []).reduce((s, o) => s + openingInBand(o, 0, th), 0);
      const tileArea = r2(Math.max(0, gross - cut));
      items.push({
        work_item_key: "wet_tiling",
        room_id: room.id,
        element_id: room.id,
        qty: tileArea,
        unit: "m2",
        wet_area: true,
        ...(ded && ded.ids.length > 0
          ? { opening_refs: ded.ids, gross_qty: r2(gross), ...derivedRefs(ded.ids) }
          : {}),
      });
    }
  }

  // --- Walls: plaster + paint, net of openings ---
  for (const w of graph.walls) {
    const a = w.polyline[0];
    const b = w.polyline[w.polyline.length - 1];
    if (!a || !b) continue;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const h = w.room_ids.reduce((m, id) => Math.max(m, ceilingByRoom.get(id) ?? 0), 0) || globalCeiling;
    const gross = length * h;
    const ded = byWall.get(w.id);
    const net = r2(Math.max(0, gross - (ded?.area ?? 0)));
    // K12: priced while any room it bounds is in scope, attributed to the first such room.
    if (w.room_ids.length > 0 && !w.room_ids.some((id) => inScope(id))) continue;
    const roomId = w.room_ids.find((id) => inScope(id)) ?? w.room_ids[0] ?? null;
    const prov =
      ded && ded.ids.length > 0
        ? { opening_refs: ded.ids, gross_qty: r2(gross), ...derivedRefs(ded.ids) }
        : {};
    items.push({ work_item_key: "wall_plaster", room_id: roomId, element_id: w.id, qty: net, unit: "m2", wet_area: false, ...prov });
    // B5 (room sheet §7 item 7): a wall that bounds only wet rooms is their tiled
    // face — painted only ABOVE the lowest tiled height among them (nothing at
    // full height). A wall with a dry room on it keeps its painted face. The
    // take-off counts one face per wall, as it always has.
    const rooms = w.room_ids.map((id) => graph.rooms.find((r) => r.id === id)).filter((r): r is (typeof graph.rooms)[number] => !!r);
    const tiledWall = rooms.length > 0 && rooms.every((r) => isWet(r.type));
    if (tiledWall) {
      const th = Math.min(...rooms.map((r) => tiledHeightOf(r, ceilingByRoom.get(r.id) ?? globalCeiling)));
      const band = Math.max(0, h - th);
      const paintGross = length * band;
      const paintCut = (openingsByWall.get(w.id) ?? []).reduce((s, o) => s + openingInBand(o, th, h), 0);
      const paintNet = r2(Math.max(0, paintGross - paintCut));
      const paintProv = paintCut > 0 && ded ? { opening_refs: ded.ids, gross_qty: r2(paintGross), ...derivedRefs(ded.ids) } : {};
      items.push({ work_item_key: "wall_paint", room_id: roomId, element_id: w.id, qty: paintNet, unit: "m2", wet_area: true, ...paintProv, tiled_m2: r2(Math.max(0, net - paintNet)) });
    } else {
      items.push({ work_item_key: "wall_paint", room_id: roomId, element_id: w.id, qty: net, unit: "m2", wet_area: false, ...prov });
    }
  }

  // --- Demolition: walls in as-built but not proposed ---
  if (opts.proposed) {
    const proposedKeys = new Set(opts.proposed.walls.map((w) => wallKey(w.polyline)));
    for (const w of graph.walls) {
      if (proposedKeys.has(wallKey(w.polyline))) continue;
      const a = w.polyline[0];
      const b = w.polyline[w.polyline.length - 1];
      if (!a || !b) continue;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const h = w.room_ids.reduce((m, id) => Math.max(m, ceilingByRoom.get(id) ?? 0), 0) || globalCeiling;
      items.push({ work_item_key: "demolition", room_id: w.room_ids[0] ?? null, element_id: w.id, qty: r2(length * h), unit: "m2", wet_area: false });
    }
  }

  return items;
}

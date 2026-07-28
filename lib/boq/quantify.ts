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
}

const WET_ROOM_TYPES = new Set(["bathroom", "ensuite", "powder", "kitchen"]);

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
 * tiling for wet rooms); walls → plaster + paint (net of openings); walls
 * present in as-built but absent in proposed → demolition.
 */
export function quantifyPlan(graph: PlanGraph, opts: QuantifyOptions = {}): TakeoffItem[] {
  const items: TakeoffItem[] = [];

  // Ceiling height per room (default 2.9 from P1).
  const ceilingByRoom = new Map<string, number>();
  for (const room of graph.rooms) ceilingByRoom.set(room.id, room.ceiling_h_m || 2.9);
  const globalCeiling =
    graph.rooms.reduce((m, r) => Math.max(m, r.ceiling_h_m || 0), 0) || 2.9;

  // --- Rooms: floor + ceiling (+ wet tiling) ---
  for (const room of graph.rooms) {
    const wet = isWet(room.type);
    const h = ceilingByRoom.get(room.id) ?? globalCeiling;
    items.push({ work_item_key: "floor_finish", room_id: room.id, element_id: room.id, qty: r2(room.area_m2), unit: "m2", wet_area: wet });
    items.push({ work_item_key: "ceiling_finish", room_id: room.id, element_id: room.id, qty: r2(room.area_m2), unit: "m2", wet_area: wet });
    if (wet) {
      // Full-height wet-wall tiling: room perimeter × ceiling height.
      const tileArea = r2(perimeterM(room.polygon) * h);
      items.push({ work_item_key: "wet_tiling", room_id: room.id, element_id: room.id, qty: tileArea, unit: "m2", wet_area: true });
    }
  }

  // Openings per wall (empty in the P1 contract today; handled if present).
  const openingAreaByWall = new Map<string, number>();
  for (const o of graph.openings) {
    const prev = openingAreaByWall.get(o.wall_id) ?? 0;
    openingAreaByWall.set(o.wall_id, prev + ((o.width_mm || 0) * (o.height_mm || 0)) / 1e6);
  }

  // --- Walls: plaster + paint, net of openings ---
  for (const w of graph.walls) {
    const a = w.polyline[0];
    const b = w.polyline[w.polyline.length - 1];
    if (!a || !b) continue;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const h = w.room_ids.reduce((m, id) => Math.max(m, ceilingByRoom.get(id) ?? 0), 0) || globalCeiling;
    const gross = length * h;
    const net = r2(Math.max(0, gross - (openingAreaByWall.get(w.id) ?? 0)));
    const roomId = w.room_ids[0] ?? null;
    items.push({ work_item_key: "wall_plaster", room_id: roomId, element_id: w.id, qty: net, unit: "m2", wet_area: false });
    items.push({ work_item_key: "wall_paint", room_id: roomId, element_id: w.id, qty: net, unit: "m2", wet_area: false });
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

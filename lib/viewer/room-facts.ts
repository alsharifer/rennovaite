// =============================================================================
// lib/viewer/room-facts.ts — what the 3D view's inspector says about a room
// (K8 #9, spec §6.8, Figma 62:1017). Pure, over the P1 PlanGraph — the same
// geometry the take-off prices — and honest about what the graph DERIVED:
// a defaulted ceiling height, an area-derived metric scale (which makes a
// perimeter an estimate), and a plan with no openings on record (which is
// "none on the plan", never "0 windows").
// =============================================================================

import type { PlanGraph } from "@/lib/plan/geometry";

export interface RoomFacts {
  id: string;
  name: string;
  area_m2: number;
  /** The DB area is authoritative; an area derived from a traced polygon is flagged (G4). */
  area_derived: boolean;
  ceiling_h_m: number | null;
  ceiling_derived: boolean;
  perimeter_m: number;
  perimeter_derived: boolean;
  walls: number;
  /** null = no openings are on the plan at all (nothing recorded, not "zero"). */
  windows: number | null;
  doors: number | null;
  unroofed: boolean;
}

function perimeter(points: [number, number][]): number {
  let p = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    p += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return p;
}

export function roomFacts(graph: Pick<PlanGraph, "rooms" | "walls" | "openings" | "derived">): RoomFacts[] {
  const noOpenings = graph.openings.length === 0;
  return graph.rooms.map((r) => {
    const wallIds = new Set(graph.walls.filter((w) => w.room_ids.includes(r.id)).map((w) => w.id));
    const mine = graph.openings.filter((o) => o.room_id === r.id || (o.wall_id != null && wallIds.has(o.wall_id)));
    return {
      id: r.id,
      name: r.name_en,
      area_m2: r.area_m2,
      area_derived: r.area_derived_m2 != null,
      ceiling_h_m: r.unroofed ? null : r.ceiling_h_m || null,
      ceiling_derived: graph.derived.ceiling_h,
      perimeter_m: perimeter(r.polygon as [number, number][]),
      perimeter_derived: graph.derived.metric_scale,
      walls: wallIds.size,
      windows: noOpenings ? null : mine.filter((o) => o.type === "window").length,
      doors: noOpenings ? null : mine.filter((o) => o.type === "door" || o.type === "archway" || o.type === "gate").length,
      unroofed: r.unroofed,
    };
  });
}

/** "4 · 1 window · 1 door" — or "4 · no openings on the plan". */
export function wallsLine(f: Pick<RoomFacts, "walls" | "windows" | "doors">): string {
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  if (f.windows == null || f.doors == null) return `${f.walls} · no openings on the plan`;
  return [String(f.walls), n(f.windows, "window"), n(f.doors, "door")].join(" · ");
}

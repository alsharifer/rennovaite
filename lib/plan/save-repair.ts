// =============================================================================
// lib/plan/save-repair.ts — overlap repair on save, confined to the overlaps.
//
// /api/update-plan re-runs overlap repair on what the editor sends, so an edit
// cannot quietly leave a plan uncostable. repairOverlaps rebuilds EVERY room
// through polygon clipping, though: vertices are snapped to the 1 mm grid and a
// neighbour's corner lying on an edge becomes a new vertex. For rooms that
// overlap nothing, that is a reshape nobody asked for — invisible on a parsed
// interior, but on a drawn garden, where zones abut all over the plot, it
// rewrote every shared edge on every save and the drawing set dimensioned the
// extra vertices (found by the G4 live dry-run). Only rooms that actually
// overlap now take the repaired shape; everything else is stored as posted.
// =============================================================================

import { repairOverlaps } from "@/lib/parse/repair";

import { findOverlaps } from "./overlaps";

export interface SaveRoom {
  id: string;
  name_en: string;
  polygon: number[][];
  area_m2: number;
}

export function repairForSave<T extends SaveRoom>(posted: T[]): { rooms: T[]; repairedIds: string[] } {
  const report = findOverlaps(posted.map((r) => ({ id: r.id, name: r.name_en, polygon: r.polygon })));
  if (!report.has_overlaps) return { rooms: posted, repairedIds: [] };

  const overlapping = new Set(report.room_ids);
  const totalPosted = posted.reduce((sum, r) => sum + r.area_m2, 0);
  const { rooms: repaired } = repairOverlaps(
    posted.map((r) => ({ id: r.id, polygon: r.polygon as [number, number][], area_m2: r.area_m2 })),
    { totalAreaM2: totalPosted },
  );
  const byId = new Map(repaired.map((r) => [r.id, r]));
  const repairedIds: string[] = [];
  const rooms = posted.map((r) => {
    const fixed = byId.get(r.id);
    if (!overlapping.has(r.id) || !fixed) return r;
    if (JSON.stringify(fixed.polygon) === JSON.stringify(r.polygon)) return r;
    repairedIds.push(r.id);
    return { ...r, polygon: fixed.polygon as number[][], area_m2: fixed.area_m2 };
  });
  return { rooms, repairedIds };
}

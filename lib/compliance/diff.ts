// =============================================================================
// lib/compliance/diff.ts — machine-checkable as-built → proposed diff (P6).
//
// Pure geometry diff over two PlanGraphs (P1 plan_snapshots). This is the input
// the permit-trigger predicates read — a finishes-only change produces an empty
// geometry diff and therefore fires no rules. No LLM.
// =============================================================================

import { wallKey } from "@/lib/boq/quantify";
import type { Opening, PlanGraph, Room, Wall } from "@/lib/plan/geometry";

export interface PlanDiff {
  /** false when there is no proposed snapshot (nothing to diff). */
  hasProposed: boolean;
  removedWalls: Wall[]; // in as-built, absent in proposed → demolition
  addedWalls: Wall[]; // in proposed, absent in as-built → new partitions
  removedRooms: Room[];
  addedRooms: Room[];
  addedOpenings: Opening[]; // new doors/windows in proposed
  /** proposed total floor area − as-built total (footprint change signal). */
  areaDeltaM2: number;
}

const EMPTY: Omit<PlanDiff, "hasProposed"> = {
  removedWalls: [],
  addedWalls: [],
  removedRooms: [],
  addedRooms: [],
  addedOpenings: [],
  areaDeltaM2: 0,
};

export function computePlanDiff(
  asBuilt: PlanGraph,
  proposed: PlanGraph | null,
): PlanDiff {
  if (!proposed) return { hasProposed: false, ...EMPTY };

  const builtWallKeys = new Set(asBuilt.walls.map((w) => wallKey(w.polyline)));
  const propWallKeys = new Set(proposed.walls.map((w) => wallKey(w.polyline)));
  const removedWalls = asBuilt.walls.filter((w) => !propWallKeys.has(wallKey(w.polyline)));
  const addedWalls = proposed.walls.filter((w) => !builtWallKeys.has(wallKey(w.polyline)));

  const builtRoomIds = new Set(asBuilt.rooms.map((r) => r.id));
  const propRoomIds = new Set(proposed.rooms.map((r) => r.id));
  const removedRooms = asBuilt.rooms.filter((r) => !propRoomIds.has(r.id));
  const addedRooms = proposed.rooms.filter((r) => !builtRoomIds.has(r.id));

  const openingKey = (o: Opening) => `${o.wall_id}|${o.type}`;
  const builtOpenings = new Set(asBuilt.openings.map(openingKey));
  const addedOpenings = proposed.openings.filter((o) => !builtOpenings.has(openingKey(o)));

  const areaDeltaM2 =
    Math.round((proposed.meta.total_area_m2 - asBuilt.meta.total_area_m2) * 10) / 10;

  return { hasProposed: true, removedWalls, addedWalls, removedRooms, addedRooms, addedOpenings, areaDeltaM2 };
}

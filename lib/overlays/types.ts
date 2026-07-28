// =============================================================================
// lib/overlays/types.ts — electrical + plumbing overlay fixtures (Prompt P2).
//
// Fixtures are points placed on the 2D plan. Position is in NORMALISED [0,1]
// plan space — the same space as rooms.polygon — so it is stable across edits
// and maps cleanly into both EditablePlanViewer and the drawing sheets (via
// PlanGraph.meta.norm_origin + unit_to_m).
// =============================================================================

export type OverlayLayer = "electrical" | "plumbing";

export const ELECTRICAL_TYPES = [
  "socket_13a",
  "socket_kitchen",
  "switch_1g",
  "switch_2way",
  "light_point",
  "ac_point",
  "dp_isolator",
  "data_point",
] as const;

export const PLUMBING_TYPES = [
  "wc_point",
  "basin_point",
  "shower_mixer",
  "sink_point",
  "washing_machine_point",
  "water_heater",
  "floor_drain",
] as const;

export type ElectricalType = (typeof ELECTRICAL_TYPES)[number];
export type PlumbingType = (typeof PLUMBING_TYPES)[number];
export type FixtureType = ElectricalType | PlumbingType;

export type FixtureSource = "rule" | "user";

export function layerOf(type: FixtureType): OverlayLayer {
  return (ELECTRICAL_TYPES as readonly string[]).includes(type)
    ? "electrical"
    : "plumbing";
}

/** Persisted plan_fixtures row (migration 015). */
export interface PlanFixture {
  id: string;
  project_id: string;
  layer: OverlayLayer;
  type: FixtureType;
  room_id: string | null;
  position: [number, number]; // normalised [0,1] plan space
  wall_id: string | null;
  spec: Record<string, unknown> | null;
  source: FixtureSource;
}

/** A seeded (pre-persistence) fixture — no id/project_id yet. */
export interface SeededFixture {
  layer: OverlayLayer;
  type: FixtureType;
  room_id: string | null;
  position: [number, number];
  wall_id: string | null;
  spec: Record<string, unknown> | null;
  source: FixtureSource;
}

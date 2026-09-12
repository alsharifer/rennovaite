// =============================================================================
// lib/overlays/types.ts — electrical + plumbing overlay fixtures (Prompt P2).
//
// Fixtures are points placed on the 2D plan. Position is in NORMALISED [0,1]
// plan space — the same space as rooms.polygon — so it is stable across edits
// and maps cleanly into both EditablePlanViewer and the drawing sheets (via
// PlanGraph.meta.norm_origin + unit_to_m).
// =============================================================================

export type OverlayLayer = "electrical" | "plumbing" | "landscape";

export const ELECTRICAL_TYPES = [
  "socket_13a",
  "socket_kitchen",
  "switch_1g",
  "switch_2way",
  "light_point",
  "ac_point",
  "dp_isolator",
  "data_point",
  // G1 garden pilot. Distinct from `light_point`: a spike or bollard fitting on
  // an external circuit, not a ceiling rose.
  "garden_light",
  // G2. Priced from its own rate, not the garden-light rate: the reference
  // project bought these as a variation whose price was already net.
  "boundary_light",
] as const;

export const PLUMBING_TYPES = [
  "wc_point",
  "basin_point",
  "shower_mixer",
  "sink_point",
  "washing_machine_point",
  "water_heater",
  "floor_drain",
  // G1 garden pilot. Distinct from `floor_drain`: an external surface gully on
  // a stormwater or soakaway run, not a wet-room trap.
  "drainage_point",
] as const;

/**
 * G3: discrete landscape items, priced per unit.
 *
 * Not zones (a zone is a surface) and not runs (a run is linear metres) —
 * things that stand in one place, which is what a fixture already is.
 */
export const LANDSCAPE_TYPES = [
  "planter_box",
  "wall_feature",
  "bbq_grill",
] as const;

export type ElectricalType = (typeof ELECTRICAL_TYPES)[number];
export type PlumbingType = (typeof PLUMBING_TYPES)[number];
export type LandscapeType = (typeof LANDSCAPE_TYPES)[number];
export type FixtureType = ElectricalType | PlumbingType | LandscapeType;

export type FixtureSource = "rule" | "user";

/** G1: the two types the garden pilot adds. Hidden from the palette when the
 *  pilot is off, so an interior project's palette is unchanged. */
export const GARDEN_TYPES: readonly FixtureType[] = [
  "garden_light",
  "boundary_light",
  "drainage_point",
];

export function layerOf(type: FixtureType): OverlayLayer {
  if ((ELECTRICAL_TYPES as readonly string[]).includes(type)) return "electrical";
  if ((LANDSCAPE_TYPES as readonly string[]).includes(type)) return "landscape";
  return "plumbing";
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

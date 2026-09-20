// =============================================================================
// lib/ground-truth/villa94-garden-plan.ts — Villa 94's garden, as the take-off
// input (G3, rebuilt on polygons in G4).
//
// The garden as the PLATFORM reads it, not as the contract states it. Since G4
// every zone area is computed from the traced polygon in
// lib/ground-truth/villa94-garden-geometry.ts — the same geometry the drawings
// dimension — so the BoQ, the dry-run and the drawing set cannot disagree about
// how big a zone is.
//
// WHAT THE DRAWING DOES NOT CARRY: the 7-sheet pack has no lighting layout.
// Point counts and the fitting mix are the contract's, and positions are placed
// AS DESIGNED — see LIGHTING_SOURCE.
// =============================================================================

import type { GardenTakeoffInput } from "@/lib/boq/garden-takeoff";

import {
  DRAWING_REF,
  LIGHTING_SOURCE,
  PLOT as GEO_PLOT,
  POINTS,
  RUNS,
  UNITS,
  lineLength,
  villa94Zones,
} from "./villa94-garden-geometry";

export const DRAWING_SCALE = "1:50";
export const PLOT = GEO_PLOT;

const ZONES = villa94Zones();

export const VILLA94_GARDEN: GardenTakeoffInput & { notes: string[] } = {
  zones: ZONES.map((z) => ({ id: z.id, name: z.name, kind: z.kind, area_m2: z.area_m2 })),
  runs: RUNS.filter((r) => r.kind !== "boundary_wall").map((r) => ({
    id: r.id,
    kind: r.kind,
    length_m: lineLength(r.polyline),
    ...(r.variant ? { variant: r.variant } : {}),
  })),
  units: UNITS.map((u) => ({ id: u.id, kind: u.type })),
  points: POINTS.map((p) => ({ id: p.id, type: p.type, zone_id: p.zone_id })),
  notes: [
    `Zones traced from ${DRAWING_REF} via PDF → SVG path extraction; every zone area is computed from its polygon, and dimensioned features (pergola 3500², counters, planter box, wall feature) reproduce their printed dimensions exactly.`,
    ...ZONES.filter((z) => z.derived_note).map((z) => `${z.name}: ${z.derived_note}`),
    `Lighting: ${LIGHTING_SOURCE}`,
  ],
};

/** G3's area-arithmetic trace, kept so the G4 geometry refinement is auditable. */
export const G3_TRACED_TOTALS = {
  paving_m2: 52.02,
  grass_m2: 62,
  planting_m2: 5.01,
  structure_m2: 12.25,
} as const;

/** Totals the dry-run reports, so the trace can be checked at a glance. */
export function tracedTotals() {
  const by = (kind: string) =>
    Math.round(
      VILLA94_GARDEN.zones.filter((z) => z.kind === kind).reduce((s, z) => s + z.area_m2, 0) * 100,
    ) / 100;
  const paving = Math.round((by("paving") + by("path")) * 100) / 100;
  return {
    paving_m2: paving,
    grass_m2: by("artificial_grass"),
    planting_m2: by("planting_bed"),
    structure_m2: by("structure"),
    /** Paving including the pergola footprint — the surface a tiler would see. */
    paved_surface_incl_structure_m2: Math.round((paving + by("structure")) * 100) / 100,
  };
}

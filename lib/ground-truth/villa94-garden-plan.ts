// =============================================================================
// lib/ground-truth/villa94-garden-plan.ts — Villa 94's garden, traced (G3).
//
// The garden as the PLATFORM reads it, not as the contract states it. Every
// figure here comes from the setting-out drawing GL-PS-001 ("AS REVISED
// SETTING OUT PLAN", 12 Sep 2025), read by converting the PDF page to SVG,
// extracting the axis-aligned path geometry, and converting to metres at the
// sheet's 1:50 viewport scale. Nothing is copied from the contract quantities —
// that is the entire point: the dry-run compares what the drawing says against
// what the contract charged.
//
// Origin is the north-west inside corner of the boundary wall; +x east, +y
// south. Plot 12.06 m × 26.64 m.
//
// WHAT THE DRAWING DOES NOT CARRY: the 7-sheet pack has no lighting layout, so
// light positions cannot be traced. Point counts are taken from the contract
// and are labelled as such in the comparison — they test the per-point RULES,
// not our ability to invent a lighting design.
// =============================================================================

import type { GardenTakeoffInput } from "@/lib/boq/garden-takeoff";

/** Sheet scale actually used by the plan viewport (title block says AS SHOWN). */
export const DRAWING_SCALE = "1:50";
export const PLOT = { width_m: 12.06, depth_m: 26.64 } as const;

const area = (w: number, d: number) => Math.round(w * d * 100) / 100;

/**
 * Traced zones.
 *
 * The pergola is its own `structure` zone and the paving around it excludes its
 * footprint, because the pergola rate is explicitly all-in (structure, coating
 * and its own downlights). Zones must not overlap — the plan's overlap gate
 * blocks costing otherwise — so one surface cannot be both.
 */
export const VILLA94_GARDEN: GardenTakeoffInput & { notes: string[] } = {
  zones: [
    // --- Backyard -----------------------------------------------------------
    {
      id: "z-planting-north",
      name: "North planting strip",
      kind: "planting_bed",
      area_m2: area(3.5, 0.6), // x 0.13..3.63, y 0.13..0.73
    },
    {
      id: "z-pergola",
      name: "Aluminium pergola",
      kind: "structure",
      area_m2: area(3.5, 3.5), // x 0.13..3.63, y 0.73..4.23 — dimensioned 3500×3500
    },
    {
      id: "z-paving-pergola-court",
      name: "Pergola court paving",
      // x 0.13..4.33, y 0.73..4.78 (17.01 m²) less the pergola footprint.
      kind: "paving",
      area_m2: Math.round((area(4.2, 4.05) - area(3.5, 3.5)) * 100) / 100,
    },
    {
      id: "z-paving-wall-feature",
      name: "Wall-feature terrace",
      kind: "paving",
      area_m2: area(3.21, 1.97), // x 4.33..7.54, y 0.13..2.10
    },
    {
      id: "z-paving-bench-court",
      name: "Seating-bench court",
      // x 7.54..11.89, y 0.13..5.10 (21.62 m²) less the quadrant the lawn's
      // curved edge takes out of its south-west corner (~1.91 m²).
      kind: "paving",
      area_m2: 19.71,
    },
    {
      id: "z-planting-west",
      name: "West planting strip",
      kind: "planting_bed",
      area_m2: area(0.6, 4.85), // x 0.13..0.73, y 4.78..9.63
    },
    {
      id: "z-lawn-back",
      name: "Backyard lawn",
      // Backyard open area 97.26 m² (three rectangles between the boundary and
      // the villa) less planting 5.01, paving 43.04 and the entrance steps 2.59.
      kind: "artificial_grass",
      area_m2: 46.62,
    },
    // --- Side courtyard -----------------------------------------------------
    {
      id: "z-paving-courtyard",
      name: "Side courtyard",
      kind: "paving",
      area_m2: area(2.49, 3.7), // x 4.43..6.92, y 9.63..13.33
    },
    // --- Front yard ---------------------------------------------------------
    {
      id: "z-paving-front",
      name: "Front approach",
      kind: "paving",
      area_m2: area(2.38, 5.05), // x 5.64..8.02, y 21.59..26.64
    },
    {
      id: "z-lawn-front",
      name: "Front lawn",
      // x 8.12..11.96, y 21.69..26.54 (18.62 m²) less the 1.8×1.8 planter box.
      kind: "artificial_grass",
      area_m2: Math.round((area(3.84, 4.85) - area(1.8, 1.8)) * 100) / 100,
    },
  ],
  runs: [
    // Dimensioned on the plan: BBQ 3000 deep × 900, bar 3400 × 450.
    { id: "r-counter-bbq", kind: "counter_run", length_m: 3.0, variant: "bbq" },
    { id: "r-counter-bar", kind: "counter_run", length_m: 3.4, variant: "bar" },
    // The L in the north-east corner is dimensioned twice: the seating bench at
    // 3600 + 3900 and the planter box outside it at 3750 + 4050.
    { id: "r-bench-l", kind: "bench_run", length_m: 7.5 },
    { id: "r-planter-l", kind: "planter_run", length_m: 7.8 },
  ],
  units: [
    { id: "u-planter-olive", kind: "planter_box" }, // front yard, 1800×1800 outer
    { id: "u-wall-feature", kind: "wall_feature" }, // backyard, 2500 wide arch
    { id: "u-bbq-grill", kind: "bbq_grill" }, // client-supplied appliance
  ],
  points: [
    // NOT traced — the drawing pack carries no lighting layout. Counts are the
    // contract's (28 garden points, 9 boundary lights from the variation), so
    // the comparison tests the per-point RULES rather than a lighting design we
    // would have invented.
    //
    // None of the 28 sits inside the pergola zone, and that is deliberate: the
    // pergola's 8 recessed downlights are part of the pergola, not separately
    // placed fixtures. The take-off's deduction rule is a safety net for when
    // somebody DOES drop a light inside a structure, not something that should
    // fire on a correctly drawn plan.
    ...Array.from({ length: 28 }, (_, i) => ({
      id: `p-garden-${i + 1}`,
      type: "garden_light",
      zone_id: "z-lawn-back",
    })),
    ...Array.from({ length: 9 }, (_, i) => ({
      id: `p-boundary-${i + 1}`,
      type: "boundary_light",
      zone_id: null,
    })),
  ],
  notes: [
    "Zones traced from GL-PS-001 at 1:50 via PDF → SVG path extraction; dimensioned features (pergola 3500², counters, planter box, wall feature) reproduce their printed dimensions exactly.",
    "The lawn's curved south-west edge in the seating-bench court is approximated as a quadrant; everything else is rectilinear on the drawing.",
    "Light and boundary-light counts come from the contract, not the drawing — the pack has no lighting layout.",
  ],
};

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

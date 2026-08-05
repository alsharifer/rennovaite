// =============================================================================
// lib/parse/constants.ts — parse + overlap-repair tunables.
//
// Centralised so the QS/partner review can retune without hunting through the
// pipeline. Each has a one-line rationale.
// =============================================================================

/** Rooms with confidence below this get a "check me" flag in the plan editor. */
export const LOW_CONFIDENCE_FLAG = 0.6;

/** If overlap-repair carves away more than this fraction of a room's original
 *  area, its confidence is downgraded (the carve implies a bad parse). */
export const CARVE_DOWNGRADE_FRACTION = 0.15;

/** Repaired polygon parts smaller than this (m²) are dropped as float slivers. */
export const SLIVER_AREA_M2 = 0.01;

/** Repaired coordinates are snapped to this grid (mm) to kill micro-gaps/overlaps. */
export const SNAP_GRID_MM = 1;

/** Assumed per-room confidence when a provider does not report one. */
export const DEFAULT_PARSE_CONFIDENCE = 0.8;

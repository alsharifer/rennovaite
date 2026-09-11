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

/**
 * How far a room's polygon may disagree with the area its provider reported
 * before the polygon wins, as a ratio of the larger to the smaller.
 *
 * The provider's area is normally the better number: on a vector sheet it comes
 * straight off the printed "3985X5000" label, while the polygon is a vision
 * model's estimate of where the walls are. Disagreement up to this ratio is the
 * polygon being approximate, and the label stands. Past it the two are not
 * describing the same room — a mis-attached label, a mis-read digit, a room
 * carved in half by overlap repair — and a made-up-looking area is worse than an
 * honestly derived one, so the geometry takes over and the room is flagged.
 *
 * 2.0 is deliberately loose. It is a mis-match detector, not an accuracy bar.
 */
export const AREA_CONTRADICTION_RATIO = 2.0;

/**
 * …and the disagreement must also be this many m² in absolute terms.
 *
 * Ratio alone is unusable on small rooms. A 2.7 m² toilet drawn one wall too
 * generously lands at 5.7, trips a 2x ratio, and loses the exactly-correct
 * "2000X1350" the drawing prints on it — over 3 m² that no quantity surveyor
 * would argue about. Both tests must fire, so "wrong" has to mean both
 * proportionally wrong and materially wrong.
 */
export const AREA_CONTRADICTION_FLOOR_M2 = 5;

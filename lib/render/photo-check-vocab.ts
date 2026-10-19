// lib/render/photo-check-vocab.ts — the placement check's words and limits,
// CLIENT-SAFE (no SDK): the studio imports these; photo-check.ts re-exports them.

export const LAYOUT_OK_LINE = "Layout follows your photo ✓";

/**
 * B2b: a fixture's box may not grow or shrink by more than this share of its
 * area in the photo (R3 P4's window came out smaller and passed on position).
 * B8: symmetric in log terms (×(1 + t) or ÷(1 + t)), between two AGREED
 * readings, set from the measured reading noise (scripts/b8-check-noise.ts,
 * 19 Oct: 24 images read twice, 68 item pairs — two single readings of one box
 * differ by ×1.40 in area at the 95th percentile, so two agreed readings, each
 * the mean of two, by ×1.27). B2b's ±25 % sat inside a single reading's noise.
 */
export const SIZE_TOLERANCE = 0.27;

/** B8: the same rule on the box's height alone (a fixture can keep its area and grow tall) — measured ×1.27 between single readings, ×1.19 between agreed ones. */
export const HEIGHT_TOLERANCE = 0.19;

/**
 * B8: a stated-height item's top, as a share of floor-to-ceiling, may be off by
 * this much (a 1.2 m cabinet = 0.43 of 2.8 m; drawn 2 m = 0.71). Two readings
 * differ by 0.10 at p95 (0.05 between agreed readings); the wider band is kept
 * because the comparison is with a STATED value, and the reader's own bias —
 * which two readings of one image cannot measure — is in it.
 */
export const TOP_TOLERANCE = 0.1;

/** Small fittings (taps, rails, hooks, a shower riser) are not checked — said on every view, not fixed. */
export const FITTINGS_NOTE = "fittings may differ";
export const FITTINGS_NOTE_FULL = "Small fittings — taps, rails, hooks, a shower riser — are not checked and may differ from the photo.";

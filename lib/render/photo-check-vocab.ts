// lib/render/photo-check-vocab.ts — the placement check's words and limits,
// CLIENT-SAFE (no SDK): the studio imports these; photo-check.ts re-exports them.

export const LAYOUT_OK_LINE = "Layout follows your photo ✓";

/**
 * B2b: a fixture's box may not grow or shrink by more than this share of its
 * area in the photo (R3 P4's window came out smaller and passed on position).
 */
export const SIZE_TOLERANCE = 0.25;

/** Small fittings (taps, rails, hooks, a shower riser) are not checked — said on every view, not fixed. */
export const FITTINGS_NOTE = "fittings may differ";
export const FITTINGS_NOTE_FULL = "Small fittings — taps, rails, hooks, a shower riser — are not checked and may differ from the photo.";

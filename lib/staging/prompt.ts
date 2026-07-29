// =============================================================================
// lib/staging/prompt.ts — render-prompt STAGING enrichment (P7).
//
// Builds the STAGING block appended to the render prompt AFTER the KG context,
// so real KG fixtures (GROHE/RAK sanitary, fixed joinery) keep precedence for
// fixed elements and staging only dresses the movable furniture. Pure — the
// caller owns the flag check and the placement.
// =============================================================================

import { getStagingSet, type StagingRoomType, type StagingSet } from "./sets";

export type StagingBlock = {
  /** Text to append to the render prompt. */
  block: string;
  /** The set used — persisted to renders.staging_set for tracing + BoQ feed. */
  set: StagingSet;
};

/**
 * The STAGING block for a (style, room) pair, or null when no set applies
 * (e.g. a bathroom or a style with no template). The wording keeps architecture
 * and any KG-named fixed elements authoritative; furniture is "arranged
 * naturally", never allowed to alter the room.
 */
export function buildStagingBlock(
  styleKey: string,
  roomType: StagingRoomType,
): StagingBlock | null {
  const set = getStagingSet(styleKey, roomType);
  if (!set || set.length === 0) return null;

  const items = set
    .map((it) => (it.qty && it.qty > 1 ? `${it.label} (×${it.qty})` : it.label))
    .join("; ");

  const block =
    `STAGING: furnish the room naturally with style-consistent pieces — ${items}. ` +
    `Arrange them to human scale and leave the architecture, wall positions, ` +
    `windows, doors, built-in joinery and any fixed fixtures exactly as they are. ` +
    `Furniture is decor only; it must not change the room's structure or finishes.`;

  return { block, set };
}

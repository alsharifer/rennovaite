// =============================================================================
// lib/staging/furniture-boq.ts — the optional "Furniture (optional)" section (P7).
//
// Builds a single, visually-separable BoQ section from the staging sets of the
// rooms a homeowner opted into. It is computed at BoQ read-time and passed to
// the view as a SEPARATE payload — it is NEVER written into `boqs.sections`, so
// every contractor-facing surface that reads the stored jsonb excludes it for
// free. Every line is `rate_status: 'indicative'` (ballpark retail, not a QS
// rate). Pure — unit-tested.
// =============================================================================

import {
  priceFor,
  tierForStyle,
  TIER_VENDOR,
  type FurniturePriceBook,
} from "./prices";
import type { StagingSet } from "./sets";

/** The work-section label — also the exclusion key for contractor exports. */
export const FURNITURE_SECTION_NAME = "Furniture (optional)";

export type FurnitureLine = {
  description: string;
  quantity: number;
  unit: string;
  rate_aed: number;
  total_aed: number;
  vendor_or_source: string;
  notes: string | null;
  rate_status: "indicative";
  room_id: string;
};

export type FurnitureSection = {
  work_section: typeof FURNITURE_SECTION_NAME;
  lines: FurnitureLine[];
  section_total_aed: number;
  /** Room ids covered — the opt-in set that produced this section. */
  room_ids: string[];
};

export type OptedRoom = {
  roomId: string;
  roomName: string;
  styleKey: string;
  set: StagingSet;
};

/**
 * Build the optional furniture section from opted-in rooms. Returns null when
 * no room contributed any priced item, so the caller can simply not render the
 * section. Removal of this whole section (toggle off) restores the base total
 * exactly, since it is additive and never touches the stored BoQ.
 */
export function buildFurnitureSection(
  rooms: OptedRoom[],
  book: FurniturePriceBook,
): FurnitureSection | null {
  const lines: FurnitureLine[] = [];

  for (const room of rooms) {
    for (const item of room.set) {
      const qty = item.qty && item.qty > 0 ? item.qty : 1;
      const rate = priceFor(book, item.key, room.styleKey);
      if (rate <= 0) continue; // no indicative price → skip, never invent one
      lines.push({
        description: `${room.roomName} — ${item.label}`,
        quantity: qty,
        unit: "no",
        rate_aed: rate,
        total_aed: rate * qty,
        vendor_or_source: TIER_VENDOR[tierForStyle(room.styleKey)],
        notes: "Indicative retail — not in contractor scope",
        rate_status: "indicative",
        room_id: room.roomId,
      });
    }
  }

  if (lines.length === 0) return null;

  const section_total_aed = lines.reduce((s, l) => s + l.total_aed, 0);
  return {
    work_section: FURNITURE_SECTION_NAME,
    lines,
    section_total_aed,
    room_ids: [...new Set(rooms.map((r) => r.roomId))],
  };
}

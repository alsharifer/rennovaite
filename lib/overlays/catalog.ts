// =============================================================================
// lib/overlays/catalog.ts — per-fixture metadata (P2).
//
// One place for each fixture type's display symbol, BoQ description, and default
// supply+install point rate. `unitRateAed: null` means we have no default rate →
// the BoQ line is flagged rate_status: 'needs_qs' for the QS to price.
// =============================================================================

import { ELECTRICAL_TYPES, PLUMBING_TYPES, type FixtureType } from "./types";

export const POMI_ELECTRICAL = "Electrical Installations";
export const POMI_PLUMBING = "Plumbing & Sanitary";

export interface FixtureMeta {
  label: string;
  /** Short code drawn on the SVG sheets (resvg has no Material Symbols font). */
  code: string;
  /** Material Symbols glyph for the in-app 2D viewer. */
  glyph: string;
  /** BoQ line description. */
  boqDescription: string;
  /** Default supply+install AED per point; null → needs_qs. */
  unitRateAed: number | null;
}

export const FIXTURE_META: Record<FixtureType, FixtureMeta> = {
  // --- Electrical ---
  socket_13a: { label: "13A socket", code: "S", glyph: "power", boqDescription: "13A twin switched socket outlet — supply & install", unitRateAed: 120 },
  socket_kitchen: { label: "Kitchen socket", code: "SK", glyph: "outlet", boqDescription: "Above-counter appliance socket outlet — supply & install", unitRateAed: 140 },
  switch_1g: { label: "1-gang switch", code: "1G", glyph: "toggle_on", boqDescription: "1-gang lighting switch — supply & install", unitRateAed: 90 },
  switch_2way: { label: "2-way switch", code: "2W", glyph: "swap_horiz", boqDescription: "2-way lighting switch — supply & install", unitRateAed: 130 },
  light_point: { label: "Light point", code: "L", glyph: "lightbulb", boqDescription: "Ceiling light point — wiring + fitting allowance", unitRateAed: 110 },
  ac_point: { label: "AC point", code: "AC", glyph: "ac_unit", boqDescription: "Split-AC indoor unit power + control point", unitRateAed: 350 },
  dp_isolator: { label: "DP isolator", code: "DP", glyph: "bolt", boqDescription: "Double-pole isolator switch — supply & install", unitRateAed: 180 },
  data_point: { label: "Data point", code: "D", glyph: "lan", boqDescription: "Structured-cabling data/TV outlet — supply & install", unitRateAed: null },
  // --- Plumbing ---
  wc_point: { label: "WC point", code: "WC", glyph: "wc", boqDescription: "WC supply + soil connection — first & second fix", unitRateAed: 850 },
  basin_point: { label: "Basin point", code: "B", glyph: "wash", boqDescription: "Wash-basin supply + waste — first & second fix", unitRateAed: 650 },
  shower_mixer: { label: "Shower mixer", code: "SH", glyph: "shower", boqDescription: "Shower mixer supply point — first & second fix", unitRateAed: 750 },
  sink_point: { label: "Sink point", code: "SN", glyph: "countertops", boqDescription: "Kitchen sink supply + waste — first & second fix", unitRateAed: 600 },
  washing_machine_point: { label: "Washing machine", code: "WM", glyph: "local_laundry_service", boqDescription: "Washing-machine supply + waste point", unitRateAed: 450 },
  water_heater: { label: "Water heater", code: "WH", glyph: "water_heater", boqDescription: "Electric water heater — supply & install", unitRateAed: null },
  floor_drain: { label: "Floor drain", code: "FD", glyph: "water_drop", boqDescription: "Wet-area floor drain + trap — supply & install", unitRateAed: 220 },
};

export function pomiSectionFor(type: FixtureType): string {
  return (ELECTRICAL_TYPES as readonly string[]).includes(type)
    ? POMI_ELECTRICAL
    : POMI_PLUMBING;
}

export { ELECTRICAL_TYPES, PLUMBING_TYPES };

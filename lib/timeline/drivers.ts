// =============================================================================
// lib/timeline/drivers.ts — project quantity drivers for the phase estimator.
//
// Every driver is read from the SAME take-off the BoQ prices, or from the BoQ's
// own section totals. Nothing here is measured a second way: if the timeline
// and the BoQ ever disagree about how much tiling there is, that is a bug, not
// a modelling choice.
//
// Pure: take-off items + section totals in, driver values out.
// =============================================================================

import { CONSTANTS } from "@/lib/boq/rules";
import type { ScopeItem } from "@/lib/boq/schema";

import type { DriverValues } from "./estimate";

/** Take-off item keys that each count as one MEP point served. */
const MEP_POINT_KEYS = [
  "elec.downlight",
  "elec.point",
  "plumb.water_heater",
  "plumb.floor_drain",
  "plumb.bath_rewire",
];

/** Item keys whose quantities are tiled area. */
const TILED_KEYS = [
  "floor.porcelain_labour",
  "floor.wood_labour",
  "wall.bath_tiling_labour",
  "floor.stair_tile",
];

/** POMI sections whose value stands in for fit-out effort. */
const FITOUT_SECTIONS = ["Joinery & Carpentry", "Sanitaryware", "Lighting"];

function sumOf(items: ScopeItem[], keys: string[]): number {
  return items
    .filter((i) => keys.includes(i.item_key))
    .reduce((s, i) => s + i.quantity, 0);
}

function qtyOf(items: ScopeItem[], key: string): number {
  return items.find((i) => i.item_key === key)?.quantity ?? 0;
}

export interface DriverInput {
  takeoffItems: ScopeItem[];
  sectionTotals: Record<string, number>;
  /** Gross floor area (m²) — the take-off's own total. */
  totalAreaM2: number;
  wetRooms: number;
}

/**
 * Compute the estimator's drivers. A driver that the take-off has no basis for
 * comes back 0, which floors its phase rather than inventing a duration.
 */
export function computeDrivers(input: DriverInput): DriverValues {
  const { takeoffItems: t, sectionTotals } = input;

  return {
    // F-11's own volume: the demolition phase is bounded by what leaves site.
    debris_m3:
      Math.round(input.totalAreaM2 * CONSTANTS.DEBRIS_M3_PER_M2 * 10) / 10,
    mep_points: sumOf(t, MEP_POINT_KEYS),
    ceiling_m2: qtyOf(t, "ceiling.gypsum"),
    tiled_m2: Math.round(sumOf(t, TILED_KEYS) * 10) / 10,
    painted_m2: qtyOf(t, "paint.full"),
    wet_rooms: input.wetRooms,
    fitout_value_aed: FITOUT_SECTIONS.reduce(
      (s, sec) => s + (sectionTotals[sec] ?? 0),
      0,
    ),
    floor_m2: Math.round(input.totalAreaM2 * 10) / 10,
  };
}

/** Section totals from a stored BoQ document, for phase inclusion + fit-out. */
export function sectionTotalsFromBoq(boq: {
  sections: { work_section: string; section_total_aed: number }[];
}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of boq.sections) {
    out[s.work_section] = (out[s.work_section] ?? 0) + s.section_total_aed;
  }
  return out;
}

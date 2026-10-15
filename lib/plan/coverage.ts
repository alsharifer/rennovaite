// =============================================================================
// lib/plan/coverage.ts — "a room may be missing" (plan check, ruled 15 Oct).
//
// When a drawing is read, the parser also estimates the whole floor
// (parsed_json.parse.provider_total_area_m2 — recorded for every reading since
// the sheet path). Rooms that cover less than COVERAGE_MIN of it are a warning
// on 01 Plan: "Rooms cover 154 of ~185 m² — a room may be missing". Interior
// rooms only (garden zones are not floor). A reading without the estimate gets
// no check — nothing is guessed. The outer-wall footprint from the drawing is
// the better yardstick and stays in the backlog (K_BACKLOG → Plan geometry).
// Pure and client-safe.
// =============================================================================

import { isOutdoorType } from "./zones";

export const COVERAGE_MIN = 0.9;

export interface Coverage {
  covered_m2: number;
  estimate_m2: number;
  ratio: number;
  warn: boolean;
  sentence: string | null;
}

/** The reading's whole-floor estimate, when the reading recorded one. */
export function readingFloorEstimate(parsedJson: unknown): number | null {
  const v = (parsedJson as { parse?: { provider_total_area_m2?: unknown } } | null)?.parse?.provider_total_area_m2;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function floorCoverage(rooms: readonly { area_m2?: number | null; room_type?: string | null }[], estimateM2: number | null): Coverage | null {
  if (!estimateM2 || estimateM2 <= 0) return null;
  const covered = rooms.filter((r) => !isOutdoorType(r.room_type)).reduce((s, r) => s + (Number(r.area_m2) > 0 ? Number(r.area_m2) : 0), 0);
  const ratio = covered / estimateM2;
  const warn = ratio < COVERAGE_MIN;
  return {
    covered_m2: covered,
    estimate_m2: estimateM2,
    ratio,
    warn,
    sentence: warn ? `Rooms cover ${Math.round(covered)} of ~${Math.round(estimateM2)} m² — a room may be missing.` : null,
  };
}

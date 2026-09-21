// =============================================================================
// lib/boq/garden-rates.ts — the landscape rate book, read from the database (T1.0).
//
// Before T1.0 the garden take-off priced straight off the GARDEN_RATES constants
// in lib/ground-truth/villa94-garden.ts. That left nothing for a firm's private
// book to overlay: an overlay needs a store to shadow, and a module constant is
// not one. The rates now live as `rate_book` rows (seeded from the same
// transcription by scripts/seed-rate-book-garden.ts) and the take-off prices
// through a `GardenRateBook`.
//
// Two ways to build a book, deliberately named apart:
//
//   loadGardenRateBook(supabase)   RUNTIME. Reads `rate_book`. Throws when the
//                                  landscape rows are absent — it never falls
//                                  back to the constants, because a silent
//                                  fallback is exactly how the database and the
//                                  priced BoQ would drift apart unnoticed.
//   transcriptionGardenBook()      OFFLINE. The transcription itself, as the
//                                  same rows the seeder writes. For the pure
//                                  calibration dry-run and unit tests, which are
//                                  checking the transcription, not the database.
//
// What stays in the module: the VOCABULARY — each key's label and unit, and the
// inclusion/absorption rules. Those describe work, not prices. The unit is also
// checked against every database row, so a row re-seeded in the wrong unit
// cannot price quietly.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  GARDEN_PROVENANCE,
  GARDEN_RATES,
  getGardenRate,
} from "@/lib/ground-truth/villa94-garden";
import {
  indexReference,
  loadReferenceRows,
  lookupCalibrated,
  lookupIndicative,
  type ReferenceRateRow,
} from "@/lib/rates/reference";

/** The landscape book has ONE grade (G3: what-if cannot regrade garden lines). */
export const GARDEN_GRADE = "standard";
export const GARDEN_ITEM_PREFIX = "garden.";
/** The seed's valid_from and work_section — shared with the seeder so the two cannot disagree. */
export const GARDEN_VALID_FROM = "2026-09-12";
export const GARDEN_WORK_SECTION = "Landscape & External Works";

export type GardenRateTier = "reference" | "indicative";

export interface GardenResolvedRate {
  rate_aed: number;
  tier: GardenRateTier;
}

export interface GardenRateBook {
  /** The rate for a garden key, or null when the book has none. */
  resolve(item_key: string): GardenResolvedRate | null;
}

export class GardenRateBookMissingError extends Error {
  constructor(detail: string) {
    super(
      `Landscape rate book not available: ${detail}. Seed it with ` +
        "`node --import ./scripts/_alias-hook.mjs scripts/seed-rate-book-garden.ts`.",
    );
    this.name = "GardenRateBookMissingError";
  }
}

/** Build a book from reference rows. Pure. */
export function gardenBookFromRows(rows: readonly ReferenceRateRow[]): GardenRateBook {
  const garden = rows.filter((r) => r.item_key.startsWith(GARDEN_ITEM_PREFIX));
  for (const r of garden) {
    const vocab = getGardenRate(r.item_key);
    if (vocab && vocab.unit !== r.unit) {
      throw new Error(
        `rate_book unit drift for ${r.item_key}: row says "${r.unit}", the take-off measures "${vocab.unit}".`,
      );
    }
  }
  const idx = indexReference(garden);
  return {
    resolve(item_key) {
      const cal = lookupCalibrated(idx, item_key, GARDEN_GRADE);
      if (cal) return { rate_aed: cal.rate_aed, tier: "reference" };
      const ind = lookupIndicative(idx, item_key, GARDEN_GRADE);
      if (ind) return { rate_aed: ind.rate_aed, tier: "indicative" };
      return null;
    },
  };
}

/** The transcription as rate_book rows — exactly what the seeder writes (minus the labels it never lets a pricing path read). */
export function transcriptionGardenRows(): ReferenceRateRow[] {
  return GARDEN_RATES.map((g) => ({
    item_key: g.item_key,
    grade: GARDEN_GRADE,
    unit: g.unit,
    rate_aed: g.net_rate,
    scope: g.scope,
    provenance: GARDEN_PROVENANCE,
    valid_from: GARDEN_VALID_FROM,
    work_section: GARDEN_WORK_SECTION,
  }));
}

/** OFFLINE book over the transcription. Never used by a route. */
export function transcriptionGardenBook(): GardenRateBook {
  return gardenBookFromRows(transcriptionGardenRows());
}

/** RUNTIME book over `rate_book`. Throws GardenRateBookMissingError rather than fall back. */
export async function loadGardenRateBook(supabase: SupabaseClient): Promise<GardenRateBook> {
  let rows: ReferenceRateRow[];
  try {
    rows = await loadReferenceRows(supabase, { itemKeyPrefix: GARDEN_ITEM_PREFIX });
  } catch (e) {
    throw new GardenRateBookMissingError(e instanceof Error ? e.message : String(e));
  }
  if (!rows.some((r) => r.provenance === "actual_transaction")) {
    throw new GardenRateBookMissingError("no calibrated garden.% rows in rate_book");
  }
  return gardenBookFromRows(rows);
}

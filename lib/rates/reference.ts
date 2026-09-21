// =============================================================================
// lib/rates/reference.ts — reading the reference rate book (`rate_book`).
//
// T1.0: this is the one store every pricing path resolves reference rates
// against. The garden take-off reads it today; the interior RateResolver reads
// it from L1 (lib/rates/overlay.ts). Before T1.0 no pricing path read the table
// at all — garden rates came from module constants and `rate_book` was a record
// the seed scripts wrote and only the what-if view read back.
//
// IDENTITY / SANITISATION: `REFERENCE_COLUMNS` is the ONLY projection a pricing
// path may select. `source` and `internal_ref` are deliberately absent: `source`
// on the Mudon interior actuals carries supplier and contractor names and
// quotation numbers (scripts/seed-rate-book-actuals.ts), and `internal_ref` is
// the garden contractor's identity. A column that is never selected cannot reach
// a resolved figure, a BoQ line or an export — which is a stronger guarantee than
// scrubbing it at the UI. The public label a resolved figure carries comes from
// code (lib/rates/tiers.ts), never from a database string.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export const REFERENCE_CITY = "Dubai";

export type RateGrade = "economy" | "standard" | "premium";
export type BookProvenance = "seed" | "indicative" | "actual_transaction";

/** A `rate_book` row as a pricing path is allowed to see it. */
export interface ReferenceRateRow {
  item_key: string;
  grade: string;
  unit: string;
  rate_aed: number;
  scope: string | null;
  provenance: BookProvenance;
  valid_from: string;
  work_section: string;
}

/** The only projection of `rate_book` a pricing path selects. No `source`, no `internal_ref`. */
export const REFERENCE_COLUMNS =
  "item_key, grade, unit, rate_aed, scope, provenance, valid_from, work_section";

const keyOf = (item_key: string, grade: string) => `${item_key}|${grade}`;

const PROVENANCE_RANK: Record<BookProvenance, number> = {
  actual_transaction: 0,
  indicative: 1,
  seed: 2,
};

/**
 * The two reference tiers, indexed by `(item_key, grade)`.
 *
 *   calibrated  `actual_transaction` rows — rates somebody actually paid.
 *   indicative  `seed` / `indicative` rows — judgement calls and placeholders.
 *
 * Within a tier the NEWEST `valid_from` wins, so a reseed supersedes rather
 * than deletes (the 022 contract). Ties break on provenance (indicative before
 * seed), then scope, so the pick is deterministic whatever order the database
 * returns rows in.
 */
export interface ReferenceIndex {
  calibrated: ReadonlyMap<string, ReferenceRateRow>;
  indicative: ReadonlyMap<string, ReferenceRateRow>;
}

export function indexReference(rows: readonly ReferenceRateRow[]): ReferenceIndex {
  const sorted = rows
    .slice()
    .sort(
      (a, b) =>
        b.valid_from.localeCompare(a.valid_from) ||
        PROVENANCE_RANK[a.provenance] - PROVENANCE_RANK[b.provenance] ||
        (a.scope ?? "~").localeCompare(b.scope ?? "~"),
    );
  const calibrated = new Map<string, ReferenceRateRow>();
  const indicative = new Map<string, ReferenceRateRow>();
  for (const r of sorted) {
    const target = r.provenance === "actual_transaction" ? calibrated : indicative;
    const k = keyOf(r.item_key, r.grade);
    if (!target.has(k)) target.set(k, r);
  }
  return { calibrated, indicative };
}

export function lookupCalibrated(idx: ReferenceIndex, item_key: string, grade: string): ReferenceRateRow | null {
  return idx.calibrated.get(keyOf(item_key, grade)) ?? null;
}

export function lookupIndicative(idx: ReferenceIndex, item_key: string, grade: string): ReferenceRateRow | null {
  return idx.indicative.get(keyOf(item_key, grade)) ?? null;
}

/**
 * Read reference rows. `itemKeyPrefix` narrows the read (the garden path reads
 * `garden.%` only). Throws on a query error — a pricing path must never price
 * off a half-read book.
 */
export async function loadReferenceRows(
  supabase: SupabaseClient,
  opts: { itemKeyPrefix?: string } = {},
): Promise<ReferenceRateRow[]> {
  let q = supabase.from("rate_book").select(REFERENCE_COLUMNS).eq("city", REFERENCE_CITY);
  if (opts.itemKeyPrefix) q = q.like("item_key", `${opts.itemKeyPrefix}%`);
  const { data, error } = await q.returns<ReferenceRateRow[]>();
  if (error) throw new Error(`rate_book read failed: ${error.message}`);
  return (data ?? []).map((r) => ({ ...r, rate_aed: Number(r.rate_aed) }));
}

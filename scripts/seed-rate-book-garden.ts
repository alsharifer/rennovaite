// =============================================================================
// scripts/seed-rate-book-garden.ts — landscape rate-book section (garden G2).
//
// Upserts the twenty Villa 94 work-item rates from
// lib/ground-truth/villa94-garden.ts. Every row is provenance
// 'actual_transaction' with the NET rate in rate_aed and the pre-discount rate
// in list_rate_aed, carrying the scope tag the calibration sheet gives it.
//
// IDENTITY: `source` carries the neutral market-reference label. The contractor
// is named only in `internal_ref` (migration 032), which nothing renders. See
// the identity rule at the top of the ground-truth module.
//
// IDEMPOTENT and NARROW: deletes only prior rows whose item_key starts with
// 'garden.', so re-running cannot touch the Mudon interior actuals or the seed
// rows. That narrowness is the point — the verification for this step is that
// zero interior rows move.
//
// Run: node scripts/seed-rate-book-garden.ts   (after migrations 022 + 032)
// =============================================================================

import { createClient } from "@supabase/supabase-js";

// The shared target guard: honours variables set in the shell over .env.local,
// prints which database it is about to write, and refuses production unless
// ALLOW_PROD_WRITE=1. (This script used to read .env.local directly, so a
// production URL set in the shell was silently ignored and dev was seeded.)
import { resolveTarget } from "./_target-guard.mjs";

import {
  GARDEN_RATES,
  INTERNAL_REF,
  PUBLIC_SOURCE_LABEL,
  ratesAreConsistent,
} from "../lib/ground-truth/villa94-garden.ts";
// T1.0: rate_book is now what the garden take-off prices from at runtime, so the
// priced fields come from transcriptionGardenRows() — the SAME rows the offline
// book prices from. The seed and the pure dry-run cannot disagree on a rate.
import { transcriptionGardenRows } from "../lib/boq/garden-rates.ts";

function buildRows() {
  const priced = new Map(transcriptionGardenRows().map((r) => [r.item_key, r] as const));
  return GARDEN_RATES.map((g) => ({
    // item_key, grade, unit, rate_aed, scope, provenance, valid_from, work_section
    ...priced.get(g.item_key)!,
    city: "Dubai",
    // A rate that arrived already net has no separate list price to record.
    // Writing the net value into list_rate_aed would make it look discounted.
    list_rate_aed: g.already_net ? null : g.list_rate,
    qs_validated: false,
    source: `${PUBLIC_SOURCE_LABEL} · ${g.label}${g.note ? ` — ${g.note}` : ""}`,
    internal_ref: INTERNAL_REF,
  }));
}

async function main() {
  const inconsistent = ratesAreConsistent();
  if (inconsistent.length > 0) {
    throw new Error(
      `Refusing to seed: discount re-applied to already-net rate(s) ${inconsistent.join(", ")}`,
    );
  }

  const { url, key } = resolveTarget({ script: "seed-rate-book-garden", writes: true });
  const supabase = createClient(url, key);

  // Blast radius, counted before and after — nothing outside 'garden.%' may move.
  const countAll = async () =>
    (await supabase.from("rate_book").select("id", { count: "exact", head: true })).count ?? 0;
  const countGarden = async () =>
    (
      await supabase
        .from("rate_book")
        .select("id", { count: "exact", head: true })
        .like("item_key", "garden.%")
    ).count ?? 0;

  const totalBefore = await countAll();
  const gardenBefore = await countGarden();
  console.log(`rate_book before: ${totalBefore} rows (${gardenBefore} garden)`);

  const del = await supabase.from("rate_book").delete().like("item_key", "garden.%");
  if (del.error) throw new Error(`delete garden rows failed: ${del.error.message}`);

  const rows = buildRows();
  const ins = await supabase.from("rate_book").insert(rows);
  if (ins.error) throw new Error(`insert failed: ${ins.error.message}`);

  const totalAfter = await countAll();
  const gardenAfter = await countGarden();
  const interiorBefore = totalBefore - gardenBefore;
  const interiorAfter = totalAfter - gardenAfter;
  console.log(`rate_book after:  ${totalAfter} rows (${gardenAfter} garden)`);
  console.log(
    interiorBefore === interiorAfter
      ? `non-garden rows unchanged: ${interiorAfter}`
      : `!! non-garden rows moved: ${interiorBefore} → ${interiorAfter}`,
  );

  const byScope = rows.reduce<Record<string, number>>(
    (m, r) => ((m[r.scope ?? "null"] = (m[r.scope ?? "null"] ?? 0) + 1), m),
    {},
  );
  console.log(`seeded ${rows.length} garden rates:`, JSON.stringify(byScope));
  console.log(
    `  already-net (no discount re-applied): ${GARDEN_RATES.filter((g) => g.already_net)
      .map((g) => g.item_key)
      .join(", ")}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

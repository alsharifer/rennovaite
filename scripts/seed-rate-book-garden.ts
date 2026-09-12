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

import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

import {
  GARDEN_PROVENANCE,
  GARDEN_RATES,
  INTERNAL_REF,
  PUBLIC_SOURCE_LABEL,
  ratesAreConsistent,
} from "../lib/ground-truth/villa94-garden.ts";

const ROOT = "C:/dev/rennovaite";
const VALID_FROM = "2026-09-12";
const WORK_SECTION = "Landscape & External Works";

async function loadEnvLocal(): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  const raw = await readFile(`${ROOT}/.env.local`, "utf8").catch(() => "");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq !== -1) env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return env;
}

function buildRows() {
  return GARDEN_RATES.map((g) => ({
    city: "Dubai",
    work_section: WORK_SECTION,
    item_key: g.item_key,
    grade: "standard",
    unit: g.unit,
    rate_aed: g.net_rate,
    // A rate that arrived already net has no separate list price to record.
    // Writing the net value into list_rate_aed would make it look discounted.
    list_rate_aed: g.already_net ? null : g.list_rate,
    scope: g.scope,
    provenance: GARDEN_PROVENANCE,
    qs_validated: false,
    source: `${PUBLIC_SOURCE_LABEL} · ${g.label}${g.note ? ` — ${g.note}` : ""}`,
    internal_ref: INTERNAL_REF,
    valid_from: VALID_FROM,
  }));
}

async function main() {
  const inconsistent = ratesAreConsistent();
  if (inconsistent.length > 0) {
    throw new Error(
      `Refusing to seed: discount re-applied to already-net rate(s) ${inconsistent.join(", ")}`,
    );
  }

  const env = await loadEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env in .env.local");
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
    (m, r) => ((m[r.scope] = (m[r.scope] ?? 0) + 1), m),
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

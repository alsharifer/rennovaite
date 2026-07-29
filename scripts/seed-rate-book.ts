// =============================================================================
// scripts/seed-rate-book.ts — populate public.rate_book (Pilot Seven / P5).
//
// Ingests the QS-validated Dubai rate sources we have — the live labour_rates
// (52 rows) + pricing_skus (600 rows) tables and the assets CSVs — and writes
// the grade→rate mapping (lib/whatif/grades.ts, itself derived from those
// sources) into rate_book with a source string + qs_validated flag per row.
//
// Run: npx tsx scripts/seed-rate-book.ts   (after applying migration 018)
// =============================================================================

import { readFile } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";

import {
  GRADE_SPECS,
  GRADEABLE_ITEMS,
  type GradeableItem,
} from "../lib/whatif/grades.ts";

const ROOT = "C:/dev/rennovaite";
const ENV_PATH = `${ROOT}/.env.local`;

const WORK_SECTION: Record<GradeableItem, string> = {
  floor_finish: "Floor Finishes",
  wet_tiling: "Wall Finishes",
  ceiling_finish: "Ceilings",
  wall_paint: "Decoration & Painting",
  wall_plaster: "Plaster",
};

async function loadEnvLocal(): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  let raw = "";
  try {
    raw = await readFile(ENV_PATH, "utf8");
  } catch {
    return env;
  }
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return env;
}

async function countCsvRows(path: string): Promise<number> {
  try {
    const raw = await readFile(path, "utf8");
    return raw.split(/\r?\n/).filter((l) => l.trim()).length - 1; // minus header
  } catch {
    return 0;
  }
}

async function main() {
  const env = await loadEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env in .env.local");
  const supabase = createClient(url, key);

  // --- ingest confirmation: the QS-validated sources ---
  const { count: labourCount } = await supabase
    .from("labour_rates")
    .select("*", { count: "exact", head: true });
  const { count: skuCount } = await supabase
    .from("pricing_skus")
    .select("*", { count: "exact", head: true });
  const labourCsv = await countCsvRows(`${ROOT}/assets/labour-rates.csv`);
  const pricingCsv = await countCsvRows(`${ROOT}/assets/pricing_skus.csv`);
  console.log(
    `ingest sources — labour_rates=${labourCount} pricing_skus=${skuCount} | ` +
      `labour-rates.csv=${labourCsv} pricing_skus.csv=${pricingCsv}`,
  );

  // --- build rate_book rows from the QS-reviewed grade specs ---
  const rows: {
    city: string;
    work_section: string;
    item_key: string;
    grade: string;
    unit: string;
    rate_aed: number;
    source: string;
    qs_validated: boolean;
  }[] = [];
  for (const item of GRADEABLE_ITEMS) {
    for (const grade of ["economy", "standard", "premium"] as const) {
      const spec = GRADE_SPECS[item][grade];
      rows.push({
        city: "Dubai",
        work_section: WORK_SECTION[item],
        item_key: item,
        grade,
        unit: "m2",
        rate_aed: spec.rate_aed,
        source: spec.source,
        qs_validated: spec.qs_validated,
      });
    }
  }

  // Replace prior Dubai rows, then insert.
  const del = await supabase.from("rate_book").delete().eq("city", "Dubai");
  if (del.error) throw new Error(`rate_book delete failed: ${del.error.message}`);
  const ins = await supabase.from("rate_book").insert(rows);
  if (ins.error) throw new Error(`rate_book insert failed: ${ins.error.message}`);

  const unvalidated = rows.filter((r) => !r.qs_validated);
  console.log(`seeded ${rows.length} rate_book rows (${unvalidated.length} pending QS validation):`);
  for (const r of unvalidated) console.log(`  - ${r.item_key}/${r.grade} @ AED ${r.rate_aed} (${r.source})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

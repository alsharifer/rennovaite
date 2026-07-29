// =============================================================================
// scripts/seed-furniture-prices.ts — populate public.furniture_prices (P7).
//
// Copies the indicative retail figures in lib/staging/prices.ts into the
// optional furniture_prices table, so a QS can revise them without a code
// deploy. The app falls back to the module defaults when the table is empty, so
// this seed is optional — it only matters if you want DB-editable overrides.
//
// Run: node scripts/seed-furniture-prices.ts   (after applying migration 021)
// =============================================================================

import { readFile } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";

import { FURNITURE_PRICES, TIER_VENDOR } from "../lib/staging/prices.ts";

const ROOT = "C:/dev/rennovaite";
const ENV_PATH = `${ROOT}/.env.local`;

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

async function main() {
  const env = await loadEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env in .env.local");
  const supabase = createClient(url, key);

  const rows: {
    item_key: string;
    tier: string;
    price_aed: number;
    vendor: string;
  }[] = [];
  for (const item of Object.keys(FURNITURE_PRICES)) {
    const byTier = FURNITURE_PRICES[item as keyof typeof FURNITURE_PRICES];
    for (const tier of ["value", "mid", "premium"] as const) {
      rows.push({
        item_key: item,
        tier,
        price_aed: byTier[tier],
        vendor: TIER_VENDOR[tier],
      });
    }
  }

  const up = await supabase
    .from("furniture_prices")
    .upsert(rows, { onConflict: "item_key,tier" });
  if (up.error) throw new Error(`furniture_prices upsert failed: ${up.error.message}`);

  console.log(
    `seeded ${rows.length} furniture_prices rows (${Object.keys(FURNITURE_PRICES).length} items × 3 tiers, all indicative)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

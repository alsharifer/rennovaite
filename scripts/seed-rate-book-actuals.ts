// =============================================================================
// scripts/seed-rate-book-actuals.ts — reseed rate_book from Mudon actuals (Step 2).
//
// Upserts one rate per priced line in the Tiles / Joinery / Aluminum & Glass /
// Sanitary quotations (lib/ground-truth/mudon-actuals.ts), plus the install_only
// labour counterparts for the supply_only trades, plus the four what-if grade
// cells the tile actuals map onto (floor_finish / wet_tiling). Every actual row
// is provenance='actual_transaction', qs_validated=false, with the net rate in
// rate_aed and the pre-discount list rate in list_rate_aed.
//
// IDEMPOTENT: deletes only prior provenance='actual_transaction' rows (never the
// seed rows) then re-inserts — run twice, no dupes. Seed rows are SUPERSEDED via
// the provenance tiebreaker in loadRateBook, not deleted.
//
// Run: node scripts/seed-rate-book-actuals.ts   (after migration 022)
// =============================================================================

import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

import {
  TILES,
  JOINERY,
  ALUMINUM,
  SANITARY,
  TRADE_TOTALS,
  netRate,
  ALUMINUM_ALLOWANCE_CAVEAT,
} from "../lib/ground-truth/mudon-actuals.ts";

const ROOT = "C:/dev/rennovaite";
const VALID_FROM = "2026-07-29"; // reseed date; provenance breaks same-day ties
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

type Row = {
  city: string; work_section: string; item_key: string; grade: string; unit: string;
  rate_aed: number; list_rate_aed: number | null; scope: string; provenance: string;
  qs_validated: boolean; source: string; valid_from: string;
};

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

function buildRows(): Row[] {
  const rows: Row[] = [];
  const base = { city: "Dubai", provenance: "actual_transaction", qs_validated: false, valid_from: VALID_FROM };

  // --- Tiles (supply_only) — every priced line + the mapped grade cells ---
  const tileSrc = `RAK cart 0000160602, 15 Jul 2026, 40% cart discount (net = 60% of list)`;
  for (const t of TILES) {
    rows.push({ ...base, work_section: "Tiles", item_key: `tile_${t.sku}`, grade: "standard", unit: "m2",
      rate_aed: netRate(t.list_rate), list_rate_aed: t.list_rate, scope: "supply_only",
      source: `${tileSrc} · ${t.sku} ${t.desc}` });
    if (t.maps_to) {
      rows.push({ ...base, work_section: "Floor Finishes", item_key: t.maps_to.item_key, grade: t.maps_to.grade, unit: "m2",
        rate_aed: netRate(t.list_rate), list_rate_aed: t.list_rate, scope: "supply_only",
        source: `${tileSrc} · maps ${t.sku} → ${t.maps_to.item_key}/${t.maps_to.grade}` });
    }
  }
  // Flooring install labour (install_only counterpart to tile supply)
  rows.push({ ...base, work_section: "Flooring Works", item_key: "flooring_labour", grade: "standard", unit: "ls",
    rate_aed: 30_500, list_rate_aed: null, scope: "install_only",
    source: "SOW AlNaseem F2 V94 (ref SOW-R02) — Flooring Works (labour only, tiles by client)" });

  // --- Joinery (supply_and_install composites — no install line ever) ---
  for (const j of JOINERY) {
    rows.push({ ...base, work_section: "Joinery", item_key: j.item_key, grade: "standard",
      unit: j.unit === "SQM" ? "m2" : "item", rate_aed: j.rate, list_rate_aed: null, scope: "supply_and_install",
      source: `Atrium QTN20261407, 14 Jul 2026, 4% disc · ${j.ref} ${j.desc}` });
  }

  // --- Aluminum & glass (supply_and_install allowance — site_assessment) ---
  for (const a of ALUMINUM) {
    rows.push({ ...base, work_section: "Aluminum & Glass", item_key: `alu_${slug(a.location + "-" + a.item)}`, grade: "standard",
      unit: a.unit === "LM" ? "lm" : "no", rate_aed: Math.round((a.total / a.qty) * 100) / 100, list_rate_aed: null,
      scope: "supply_and_install",
      source: `Global Creation ref 3936/R1, 17 Jul 2026 · ${a.location}: ${a.item} · ${ALUMINUM_ALLOWANCE_CAVEAT}` });
  }

  // --- Sanitary (supply_only) + install labour counterpart ---
  for (const s of SANITARY) {
    rows.push({ ...base, work_section: "Sanitaryware", item_key: `san_${slug(s.code)}`, grade: "standard", unit: "no",
      rate_aed: s.unit_price, list_rate_aed: null, scope: "supply_only",
      source: `Laspinas quotation 46703, 13 Jun 2026 · ${s.code} ${s.desc}` });
  }
  rows.push({ ...base, work_section: "Sanitary & Plumbing", item_key: "sanitary_labour", grade: "standard", unit: "ls",
    rate_aed: 20_000, list_rate_aed: null, scope: "install_only",
    source: "SOW AlNaseem F2 V94 (ref SOW-R02) — Sanitary & Plumbing (labour, fixtures by client)" });

  return rows;
}

async function main() {
  const env = await loadEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env in .env.local");
  const supabase = createClient(url, key);

  // Idempotency: remove only our prior actual_transaction rows (keep seed rows).
  const del = await supabase.from("rate_book").delete().eq("provenance", "actual_transaction");
  if (del.error) throw new Error(`delete actuals failed: ${del.error.message}`);

  const rows = buildRows();
  const ins = await supabase.from("rate_book").insert(rows);
  if (ins.error) throw new Error(`insert failed: ${ins.error.message}`);

  const byScope = rows.reduce<Record<string, number>>((m, r) => ((m[r.scope] = (m[r.scope] ?? 0) + 1), m), {});
  console.log(`reseeded ${rows.length} actual_transaction rows:`, JSON.stringify(byScope));
  console.log(`  mapped grade cells: floor_finish std=${netRate(181)} prem=${netRate(446.45)}, wet_tiling std=${netRate(141)} prem=${netRate(446.45)}`);
  console.log(`  trade totals (excl VAT): tiles=${TRADE_TOTALS.tiles.excl_vat} joinery=${TRADE_TOTALS.joinery.excl_vat} aluminum=${TRADE_TOTALS.aluminum.excl_vat} sanitary=${TRADE_TOTALS.sanitary.excl_vat}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

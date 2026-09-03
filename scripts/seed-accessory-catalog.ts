// =============================================================================
// scripts/seed-accessory-catalog.ts — populate accessory_catalog (D1).
//
// Run:  node scripts/seed-accessory-catalog.ts
// (tsx is not available in this repo; this file is plain JS-compatible TS run
// directly by node, same as the other seed scripts.)
//
// Idempotent: upserts on (item_key, model_code|name), so re-running updates
// rates in place rather than duplicating rows.
//
// Sources are documented in lib/accessories/seed-data.ts — sanitary from the
// Mudon Laspinas quotation, AC/lighting/electrical from the verified
// pricing_skus vendor catalogue. Nothing is invented; categories with no real
// source ship with no alternatives and an explicit reason.
// =============================================================================

import fs from "node:fs";
import path from "node:path";

import { buildCatalog, type SkuRow } from "../lib/accessories/seed-data";

function readEnv(): Record<string, string> {
  const file = path.join(process.cwd(), ".env.local");
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

async function main() {
  const env = readEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars missing from .env.local");
  const H = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  // Pull the SKU catalogue the vendor-derived rows are built from.
  const skuRes = await fetch(
    `${url}/rest/v1/pricing_skus?select=sku,brand,category,subcategory,description_en,price_aed,vendor,lead_time_days,last_verified&limit=2000`,
    { headers: H },
  );
  if (!skuRes.ok) throw new Error(`pricing_skus read failed: ${skuRes.status}`);
  const skus = (await skuRes.json()) as SkuRow[];
  console.log(`read ${skus.length} pricing_skus rows`);

  const rows = buildCatalog(skus);
  console.log(`built ${rows.length} catalogue rows`);

  const byCategory = rows.reduce<Record<string, number>>((a, r) => {
    a[r.category] = (a[r.category] ?? 0) + 1;
    return a;
  }, {});
  for (const [c, n] of Object.entries(byCategory).sort()) {
    console.log(`  ${c.padEnd(20)} ${n}`);
  }

  const res = await fetch(
    `${url}/rest/v1/accessory_catalog?on_conflict=item_key,model_code`,
    {
      method: "POST",
      headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    },
  );
  if (!res.ok) {
    // The unique index is on coalesce(model_code, name), which PostgREST cannot
    // name directly — fall back to delete-then-insert, still idempotent.
    console.log(`upsert declined (${res.status}); replacing the catalogue instead`);
    const del = await fetch(`${url}/rest/v1/accessory_catalog?id=not.is.null`, {
      method: "DELETE",
      headers: H,
    });
    if (!del.ok) throw new Error(`clear failed: ${del.status} ${await del.text()}`);
    const ins = await fetch(`${url}/rest/v1/accessory_catalog`, {
      method: "POST",
      headers: { ...H, Prefer: "return=minimal" },
      body: JSON.stringify(rows),
    });
    if (!ins.ok) throw new Error(`insert failed: ${ins.status} ${await ins.text()}`);
  }

  const count = await fetch(`${url}/rest/v1/accessory_catalog?select=id`, {
    headers: { ...H, Prefer: "count=exact", Range: "0-0" },
  });
  console.log(`accessory_catalog now holds ${count.headers.get("content-range")} rows`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

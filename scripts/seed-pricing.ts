// One-off seeder for the pricing_skus table.
//
// Reads the canonical pricing CSV and inserts every priced row using the
// Supabase service-role client. Re-runs will create duplicates — truncate
// before re-running if needed.

import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const CSV_PATH = "C:/dev/rennovaite/assets/pricing_skus.csv.csv";
const ENV_PATH = "C:/dev/rennovaite/.env.local";
const BATCH_SIZE = 100;

async function loadEnvLocal(): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(ENV_PATH, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

type SkuRow = {
  sku: string | null;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  description_en: string | null;
  description_ar: string | null;
  unit: string | null;
  price_aed: number;
  vendor: string | null;
  source_url: string | null;
  photo_url: string | null;
  lead_time_days: number | null;
  in_stock: boolean | null;
  last_verified: string | null;
};

const blankToNull = (v: string | undefined): string | null => {
  if (v == null) return null;
  const t = v.trim();
  return t === "" ? null : t;
};

async function main(): Promise<void> {
  await loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error(
      `Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (looked in ${ENV_PATH}).`,
    );
    process.exit(1);
  }

  console.log(`Reading CSV from ${CSV_PATH}`);
  const csv = await readFile(CSV_PATH, "utf8");
  const rows = parseCsv(csv);
  if (rows.length < 2) {
    console.error("CSV has no data rows.");
    process.exit(1);
  }

  const header = rows[0]!.map((h) => h.trim());
  const idx = (name: string): number => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`Missing CSV column: ${name}`);
    return i;
  };
  const cSku = idx("SKU");
  const cBrand = idx("Brand");
  const cCategory = idx("Category");
  const cSubcategory = idx("Subcategory");
  const cDescEn = idx("Description_en");
  const cDescAr = idx("Description_ar");
  const cUnit = idx("Unit");
  const cPrice = idx("Price_aed");
  const cVendor = idx("Vendor");
  const cSource = idx("Source_url");
  const cPhoto = idx("Photo_url");
  const cLead = idx("Lead_time_days");
  const cStock = idx("in_stock");
  const cVerified = idx("Last_verified");

  const records: SkuRow[] = [];
  let skippedNoPrice = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (row.length === 1 && row[0] === "") continue;
    const priceRaw = blankToNull(row[cPrice]);
    if (priceRaw === null) {
      skippedNoPrice++;
      continue;
    }
    const price = Number(priceRaw.replace(/,/g, ""));
    if (!Number.isFinite(price)) {
      skippedNoPrice++;
      continue;
    }

    const leadRaw = blankToNull(row[cLead]);
    const leadDays = leadRaw === null ? null : Number(leadRaw);

    const stockRaw = blankToNull(row[cStock]);
    const stock =
      stockRaw === null ? null : /^(true|1|yes)$/i.test(stockRaw);

    records.push({
      sku: blankToNull(row[cSku]),
      brand: blankToNull(row[cBrand]),
      category: blankToNull(row[cCategory]),
      subcategory: blankToNull(row[cSubcategory]),
      description_en: blankToNull(row[cDescEn]),
      description_ar: blankToNull(row[cDescAr]),
      unit: blankToNull(row[cUnit]),
      price_aed: price,
      vendor: blankToNull(row[cVendor]),
      source_url: blankToNull(row[cSource]),
      photo_url: blankToNull(row[cPhoto]),
      lead_time_days:
        leadDays != null && Number.isFinite(leadDays) ? leadDays : null,
      in_stock: stock,
      last_verified: blankToNull(row[cVerified]),
    });
  }

  console.log(
    `Parsed ${records.length} priced rows (skipped ${skippedNoPrice} without a price).`,
  );

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let inserted = 0;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("pricing_skus").insert(batch);
    if (error) {
      console.error(`Batch starting at row ${i + 1} failed:`, error.message);
      process.exit(1);
    }
    inserted += batch.length;
    console.log(`  inserted ${inserted}/${records.length}`);
  }

  console.log(`Done. Inserted ${inserted} rows into pricing_skus.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

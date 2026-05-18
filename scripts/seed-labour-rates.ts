// One-off seeder for the labour_rates table.
//
// Reads assets/labour-rates.csv and inserts every valid row via the
// service-role admin client. Run once — re-running creates duplicates.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { type SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "../lib/supabase-admin";

const CSV_PATH = resolve(process.cwd(), "assets/labour-rates.csv");
const ENV_PATH = "C:/dev/rennovaite/.env.local";

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

type CsvRow = {
  work_section?: string;
  description?: string;
  unit?: string;
  rate_low_aed?: string;
  rate_mid_aed?: string;
  rate_high_aed?: string;
  source?: string;
  notes?: string;
};

type LabourRow = {
  work_section: string;
  description: string;
  unit: string | null;
  rate_low_aed: number | null;
  rate_mid_aed: number | null;
  rate_high_aed: number | null;
  source: string | null;
  notes: string | null;
};

const blank = (v: string | undefined): string | null => {
  if (v == null) return null;
  const t = v.trim();
  return t === "" ? null : t;
};

const numeric = (v: string | undefined): number | null => {
  const s = blank(v);
  if (s === null) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

const shortLabel = (description: string): string => {
  const beforeDash = description.split(/\s+—\s+/)[0]!.trim();
  if (beforeDash.length < description.length) return beforeDash;
  return description.length > 50 ? `${description.slice(0, 47)}…` : description;
};

async function main(): Promise<void> {
  await loadEnvLocal();

  const csvText = await readFile(CSV_PATH, "utf8");
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: false,
    bom: true,
  }) as CsvRow[];

  const total = records.length;
  const toInsert: LabourRow[] = [];
  let skipped = 0;
  const skipReasons: string[] = [];

  for (const r of records) {
    const work_section = blank(r.work_section);
    const description = blank(r.description);
    if (!work_section || !description) {
      skipped++;
      skipReasons.push(
        `missing ${!work_section ? "work_section" : "description"}`,
      );
      continue;
    }
    toInsert.push({
      work_section,
      description,
      unit: blank(r.unit),
      rate_low_aed: numeric(r.rate_low_aed),
      rate_mid_aed: numeric(r.rate_mid_aed),
      rate_high_aed: numeric(r.rate_high_aed),
      source: blank(r.source),
      notes: blank(r.notes),
    });
  }

  console.log(
    `Read ${total} CSV rows — ${toInsert.length} valid, ${skipped} skipped.`,
  );

  const admin = supabaseAdmin as unknown as SupabaseClient;
  let inserted = 0;
  let insertErrors = 0;

  for (let i = 0; i < toInsert.length; i++) {
    const row = toInsert[i]!;
    const label = `${row.work_section} — ${shortLabel(row.description)}`;
    const { error } = await admin.from("labour_rates").insert(row);
    if (error) {
      console.log(`[${i + 1}/${toInsert.length}] ${label} ✗ ${error.message}`);
      insertErrors++;
      continue;
    }
    inserted++;
    console.log(`[${i + 1}/${toInsert.length}] ${label} ✓`);
  }

  console.log(
    `\nInserted ${inserted} rows, skipped ${skipped} rows due to validation.${
      insertErrors > 0 ? ` (${insertErrors} insert errors)` : ""
    }`,
  );
}

main().catch((err) => {
  console.error("Seeder failed:", err);
  process.exit(1);
});

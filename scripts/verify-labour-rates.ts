// Quick verification: count rows in labour_rates and show a 3-row sample.
import { readFile } from "node:fs/promises";
import { type SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../lib/supabase-admin";

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

async function main(): Promise<void> {
  await loadEnvLocal();
  const admin = supabaseAdmin as unknown as SupabaseClient;

  const { count, error: countErr } = await admin
    .from("labour_rates")
    .select("*", { count: "exact", head: true });
  if (countErr) throw countErr;
  console.log(`labour_rates row count: ${count}`);

  const { data, error } = await admin
    .from("labour_rates")
    .select(
      "work_section,description,unit,rate_low_aed,rate_mid_aed,rate_high_aed,source,notes",
    )
    .limit(3);
  if (error) throw error;
  console.log("\nSample (3 rows):");
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

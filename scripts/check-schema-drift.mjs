#!/usr/bin/env node
// =============================================================================
// scripts/check-schema-drift.mjs — do dev and production have the same schema?
//
// Run:
//   DEV_SUPABASE_URL=…  DEV_SERVICE_ROLE_KEY=…  \
//   PROD_SUPABASE_URL=… PROD_SERVICE_ROLE_KEY=… \
//   node scripts/check-schema-drift.mjs
//
// READ-ONLY against both. It issues `select=<cols>&limit=0` requests, which
// return no rows — PostgREST still validates every column name, so a missing
// column is a 400 and a missing table is a 404. No data crosses between the two.
//
// WHAT IT CANNOT SEE, stated because a drift check people trust more than it
// deserves is worse than none: PostgREST cannot enumerate a schema. The column
// list comes from supabase/migrations, so this proves "both databases have what
// the migrations describe". Anything created by hand in a dashboard — a column,
// an index, an RLS policy, a trigger — is invisible to it in both directions.
// Closing that needs `pg_dump --schema-only`, which needs the database password
// (I9).
// =============================================================================

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Columns per table, parsed from the migration SQL rather than from a live DB
 *  — the migrations are the specification both databases are measured against. */
export function schemaFromMigrations(dir = "supabase/migrations") {
  const tables = new Map();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), "utf8");

    // create table [if not exists] public.<name> ( ... );
    for (const m of sql.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)\s*\(([\s\S]*?)\n\s*\);/gi,
    )) {
      const [, table, body] = m;
      const cols = tables.get(table) ?? new Set();
      for (const line of body.split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("--")) continue;
        // Skip table-level constraints.
        if (/^(primary\s+key|unique|constraint|check|foreign\s+key|exclude)\b/i.test(t)) continue;
        const cm = /^([a-z0-9_]+)\s+/i.exec(t);
        if (cm) cols.add(cm[1]);
      }
      tables.set(table, cols);
    }

    // alter table ... add column [if not exists] <name>
    for (const m of sql.matchAll(
      /alter\s+table\s+(?:only\s+)?(?:public\.)?([a-z0-9_]+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z0-9_]+)/gi,
    )) {
      const [, table, col] = m;
      const cols = tables.get(table) ?? new Set();
      cols.add(col);
      tables.set(table, cols);
    }
  }
  return tables;
}

async function probe(url, key, table, cols) {
  const r = await fetch(
    `${url}/rest/v1/${table}?select=${cols.join(",")}&limit=0`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (r.status === 200) return { ok: true };
  const body = await r.text();
  return { ok: false, status: r.status, body: body.slice(0, 200) };
}

async function inspect(label, url, key, tables) {
  const missingTables = [];
  const missingCols = [];
  for (const [table, colSet] of tables) {
    const cols = [...colSet];
    const res = await probe(url, key, table, cols);
    if (res.ok) continue;
    if (/does not exist|Could not find the table/i.test(res.body)) {
      missingTables.push(table);
      continue;
    }
    for (const c of cols) {
      const rr = await probe(url, key, table, [c]);
      if (!rr.ok) missingCols.push(`${table}.${c}`);
    }
  }
  console.log(
    `${label}: ${tables.size} tables expected · ${missingTables.length} missing · ${missingCols.length} missing columns`,
  );
  return { missingTables, missingCols };
}

async function main() {
  const dev = { url: process.env.DEV_SUPABASE_URL, key: process.env.DEV_SERVICE_ROLE_KEY };
  const prod = { url: process.env.PROD_SUPABASE_URL, key: process.env.PROD_SERVICE_ROLE_KEY };

  const tables = schemaFromMigrations();
  console.log(`parsed ${tables.size} tables from supabase/migrations\n`);

  if (!dev.url || !dev.key) {
    console.log(
      "DEV_SUPABASE_URL / DEV_SERVICE_ROLE_KEY not set — nothing to compare.\n" +
        "This is expected until the dev project exists (I8 step 1).",
    );
    process.exit(0);
  }

  const d = await inspect("dev ", dev.url, dev.key, tables);
  if (!prod.url || !prod.key) {
    console.log("\nPROD_* not set — checked dev against the migrations only.");
    process.exit(d.missingTables.length + d.missingCols.length > 0 ? 1 : 0);
  }
  const p = await inspect("prod", prod.url, prod.key, tables);

  const only = (a, b) => a.filter((x) => !b.includes(x));
  const devOnlyMissing = [...only(d.missingTables, p.missingTables), ...only(d.missingCols, p.missingCols)];
  const prodOnlyMissing = [...only(p.missingTables, d.missingTables), ...only(p.missingCols, d.missingCols)];

  console.log("\nDRIFT");
  console.log("  present in prod, absent in dev :", devOnlyMissing.length ? devOnlyMissing.join(", ") : "none");
  console.log("  present in dev, absent in prod :", prodOnlyMissing.length ? prodOnlyMissing.join(", ") : "none");

  const drifted = devOnlyMissing.length + prodOnlyMissing.length;
  if (drifted > 0) {
    console.error(`\n${drifted} difference(s). Run \`supabase db push\` against whichever is behind.`);
    process.exit(1);
  }
  console.log("\ndev and prod agree on everything the migrations describe.");
}

if (process.argv[1]?.endsWith("check-schema-drift.mjs")) {
  void execFileSync;
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

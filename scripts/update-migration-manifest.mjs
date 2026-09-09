#!/usr/bin/env node
// Adds any NEW migration to the manifest. It never rewrites an existing
// entry — that is the whole point of the manifest, and the check script fails
// if a tracked file's hash moves.
//
// Run after adding a migration:  node scripts/update-migration-manifest.mjs
import fs from "node:fs";
import path from "node:path";

import { hashMigration } from "./check-migrations.mjs";

const DIR = "supabase/migrations";
const MANIFEST = "supabase/migrations.manifest.json";

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const known = new Set(manifest.migrations.map((m) => `${m.version}_${m.name}.sql`));

const added = [];
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
  if (known.has(file)) continue;
  const m = /^(\d{14})_(.+)\.sql$/.exec(file);
  if (!m) {
    console.error(`skipping ${file} — not <14-digit version>_<name>.sql`);
    continue;
  }
  manifest.migrations.push({
    legacy: null,
    version: m[1],
    name: m[2],
    sha256: hashMigration(fs.readFileSync(path.join(DIR, file), "utf8")),
  });
  added.push(file);
}

if (added.length === 0) {
  console.log("no new migrations");
} else {
  manifest.migrations.sort((a, b) => a.version.localeCompare(b.version));
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`added ${added.length}:\n${added.map((f) => "  + " + f).join("\n")}`);
}

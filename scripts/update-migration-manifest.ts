// Adds any NEW migration to the manifest. It never rewrites an existing entry —
// that is the whole point, and check-migrations fails if a tracked hash moves.
//
// Run: node --import ./scripts/_alias-hook.mjs scripts/update-migration-manifest.ts
import fs from "node:fs";
import path from "node:path";

import {
  MANIFEST_PATH,
  MIGRATIONS_DIR,
  hashMigration,
  listMigrations,
  readManifest,
} from "../lib/migrations/history.ts";

const manifest = readManifest();
const known = new Set(manifest.migrations.map((m) => `${m.version}_${m.name}.sql`));

const added: string[] = [];
for (const file of listMigrations()) {
  if (known.has(file)) continue;
  const m = /^(\d{14})_(.+)\.sql$/.exec(file);
  if (!m) {
    console.error(`skipping ${file} — not <14-digit version>_<name>.sql`);
    continue;
  }
  manifest.migrations.push({
    legacy: null,
    version: m[1]!,
    name: m[2]!,
    sha256: hashMigration(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8")),
  });
  added.push(file);
}

if (added.length === 0) {
  console.log("no new migrations");
} else {
  manifest.migrations.sort((a, b) => a.version.localeCompare(b.version));
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`added ${added.length}:\n${added.map((f) => "  + " + f).join("\n")}`);
}

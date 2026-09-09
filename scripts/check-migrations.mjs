#!/usr/bin/env node
// =============================================================================
// scripts/check-migrations.mjs — migration history is append-only (I7).
//
// The Supabase CLI records which versions have run, so it will not re-apply
// one. What it cannot see is a migration file being EDITED after it ran: the
// version is unchanged, so every database that already applied it keeps the old
// statements while the repo shows the new ones, and the two drift apart
// silently and permanently.
//
// So this hashes every migration and compares against the manifest committed
// when the file was introduced. A changed file fails. A migration that has run
// anywhere can never be edited — only superseded by a new one.
//
// Run: node scripts/check-migrations.mjs
// Also enforced by lib/__tests__/migrations.test.ts so the suite catches it.
// =============================================================================

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";
const MANIFEST = "supabase/migrations.manifest.json";

/** sha256 of a migration, newline-normalised so CRLF checkouts agree. */
export function hashMigration(body) {
  return crypto.createHash("sha256").update(body.replace(/\r\n/g, "\n")).digest("hex");
}

export function checkMigrations(root = process.cwd()) {
  const dir = path.join(root, MIGRATIONS_DIR);
  const manifestPath = path.join(root, MANIFEST);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const known = new Map(manifest.migrations.map((m) => [`${m.version}_${m.name}.sql`, m]));

  const onDisk = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const errors = [];

  for (const file of onDisk) {
    const entry = known.get(file);
    const body = fs.readFileSync(path.join(dir, file), "utf8");
    if (!entry) continue; // new migration, not yet in the manifest — see below
    const actual = hashMigration(body);
    if (actual !== entry.sha256) {
      errors.push(
        `EDITED: ${file}\n  manifest ${entry.sha256.slice(0, 16)}…\n  on disk  ${actual.slice(0, 16)}…\n` +
          `  A migration that has run cannot be edited. Add a NEW migration that supersedes it.`,
      );
    }
  }

  for (const [file] of known) {
    if (!onDisk.includes(file)) {
      errors.push(
        `DELETED: ${file}\n  It is in the manifest, so it may already have run somewhere. ` +
          `Deleting it means a fresh database can no longer reproduce that schema.`,
      );
    }
  }

  // Ordering: the CLI applies by filename, so a version that sorts out of
  // sequence would run at the wrong time on a fresh database.
  const versions = onDisk.map((f) => f.split("_")[0]);
  const sorted = [...versions].sort();
  if (JSON.stringify(versions) !== JSON.stringify(sorted)) {
    errors.push("ORDER: filenames do not sort into their version order.");
  }

  const untracked = onDisk.filter((f) => !known.has(f));

  return { checked: onDisk.length, errors, untracked };
}

// --- CLI ---------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]?.split("\\").join("/")}` || process.argv[1]?.endsWith("check-migrations.mjs")) {
  const { checked, errors, untracked } = checkMigrations();
  console.log(`checked ${checked} migrations against the manifest`);
  if (untracked.length > 0) {
    console.log(
      `\n${untracked.length} migration(s) not yet in the manifest:\n` +
        untracked.map((f) => `  + ${f}`).join("\n") +
        `\n\nAdd them with:  node scripts/update-migration-manifest.mjs`,
    );
  }
  if (errors.length > 0) {
    console.error(`\n${errors.length} problem(s):\n\n${errors.join("\n\n")}`);
    process.exit(1);
  }
  console.log("history intact — no migration has been edited or removed");
}

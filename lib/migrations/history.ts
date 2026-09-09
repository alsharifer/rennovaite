// =============================================================================
// lib/migrations/history.ts — migration history is append-only (I7).
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
// Lives in lib/ rather than scripts/ so the test and the CLI share ONE module
// in ONE format. The first version was a .mjs imported from a .ts test, which
// node ran happily and vitest could not parse at all — the check passed by hand
// and silently stopped running in the suite.
// =============================================================================

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const MIGRATIONS_DIR = "supabase/migrations";
export const MANIFEST_PATH = "supabase/migrations.manifest.json";

export interface ManifestEntry {
  legacy: string | null;
  version: string;
  name: string;
  sha256: string;
}

export interface Manifest {
  note?: string;
  generated?: string;
  source?: string;
  migrations: ManifestEntry[];
}

export interface HistoryReport {
  checked: number;
  errors: string[];
  /** On disk but not yet recorded — legal, but must be registered. */
  untracked: string[];
}

/** sha256 of a migration, newline-normalised so CRLF checkouts agree. */
export function hashMigration(body: string): string {
  return crypto.createHash("sha256").update(body.replace(/\r\n/g, "\n")).digest("hex");
}

export function readManifest(root = process.cwd()): Manifest {
  return JSON.parse(fs.readFileSync(path.join(root, MANIFEST_PATH), "utf8")) as Manifest;
}

export function listMigrations(root = process.cwd()): string[] {
  return fs
    .readdirSync(path.join(root, MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export function checkMigrations(root = process.cwd()): HistoryReport {
  const dir = path.join(root, MIGRATIONS_DIR);
  const manifest = readManifest(root);
  const known = new Map(manifest.migrations.map((m) => [`${m.version}_${m.name}.sql`, m]));
  const onDisk = listMigrations(root);

  const errors: string[] = [];

  for (const file of onDisk) {
    const entry = known.get(file);
    if (!entry) continue; // new migration — reported as untracked below
    const actual = hashMigration(fs.readFileSync(path.join(dir, file), "utf8"));
    if (actual !== entry.sha256) {
      errors.push(
        `EDITED: ${file}\n  manifest ${entry.sha256.slice(0, 16)}…\n  on disk  ${actual.slice(0, 16)}…\n` +
          `  A migration that has run cannot be edited. Add a NEW migration that supersedes it.`,
      );
    }
  }

  for (const file of known.keys()) {
    if (!onDisk.includes(file)) {
      errors.push(
        `DELETED: ${file}\n  It is in the manifest, so it may already have run somewhere. ` +
          `Deleting it means a fresh database can no longer reproduce that schema.`,
      );
    }
  }

  // The CLI applies by filename, so a version that sorts out of sequence would
  // run at the wrong point on a fresh database.
  const versions = onDisk.map((f) => f.split("_")[0]!);
  if (JSON.stringify(versions) !== JSON.stringify([...versions].sort())) {
    errors.push("ORDER: filenames do not sort into their version order.");
  }

  return {
    checked: onDisk.length,
    errors,
    untracked: onDisk.filter((f) => !known.has(f)),
  };
}

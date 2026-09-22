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

// ---------------------------------------------------------------------------
// The frozen mirror (T6)
//
// `scripts/migrations/` holds the thirty migrations that were applied BY HAND
// before the CLI runner existed. It is a historical record, formally RETIRED:
// the live directory is `supabase/migrations/`, applied with `npm run db:push`.
// The mirror stopping at 030 is therefore correct, not drift — but only while
// three things hold, which is what this checks:
//   1. the mirror is exactly those thirty files plus its README (nothing added,
//      nothing deleted — an addition here would be a migration nothing runs);
//   2. every one of them is mapped into the live directory by the manifest's
//      `legacy` field, and every `legacy` mapping points at a file that exists;
//   3. nothing in the repo still TELLS a reader to run one of them.
// ---------------------------------------------------------------------------

export const FROZEN_DIR = "scripts/migrations";
/** The mirror was frozen after 030 (I7); the live set continues as timestamps. */
export const FROZEN_COUNT = 30;

export interface MirrorReport {
  frozen: string[];
  errors: string[];
}

/** Files that legitimately DESCRIBE the frozen mirror rather than instruct its use. */
const MIRROR_PROSE_ALLOWED = [
  "scripts/migrations/README.md",
  "docs/MIGRATIONS.md",
  "docs/DEV_PROD_SEPARATION.md",
  "docs/RENDER_UPGRADE_PLAYBOOK.md",
  "lib/migrations/history.ts",
  "supabase/migrations.manifest.json",
];

export function checkFrozenMirror(root = process.cwd()): MirrorReport {
  const errors: string[] = [];
  const dir = path.join(root, FROZEN_DIR);
  const entries = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  const frozen = entries.filter((f) => /^\d{3}_.*\.sql$/.test(f));
  const strays = entries.filter((f) => !/^\d{3}_.*\.sql$/.test(f) && f !== "README.md");

  if (frozen.length !== FROZEN_COUNT) {
    errors.push(
      `MIRROR: ${FROZEN_DIR} holds ${frozen.length} numbered migrations, expected ${FROZEN_COUNT}. ` +
        `The mirror is a frozen record — a new migration belongs in ${MIGRATIONS_DIR} only.`,
    );
  }
  if (strays.length > 0) errors.push(`MIRROR: unexpected file(s) in ${FROZEN_DIR}: ${strays.join(", ")}`);
  if (!entries.includes("README.md")) errors.push(`MIRROR: ${FROZEN_DIR}/README.md is missing — it is what says the directory is frozen.`);

  // Every frozen file is mapped into the live directory, and every mapping resolves.
  const manifest = readManifest(root);
  const legacy = new Map(manifest.migrations.filter((m) => m.legacy).map((m) => [m.legacy!, m]));
  for (const f of frozen) {
    const entry = legacy.get(f);
    if (!entry) errors.push(`MIRROR: ${f} has no live counterpart in the manifest — the historical record and ${MIGRATIONS_DIR} disagree.`);
    else if (!fs.existsSync(path.join(root, MIGRATIONS_DIR, `${entry.version}_${entry.name}.sql`))) {
      errors.push(`MIRROR: ${f} maps to ${entry.version}_${entry.name}.sql, which is not in ${MIGRATIONS_DIR}.`);
    }
  }
  for (const name of legacy.keys()) {
    if (!frozen.includes(name)) errors.push(`MIRROR: the manifest maps a legacy file ${name} that is not in ${FROZEN_DIR}.`);
  }
  return { frozen, errors };
}

/**
 * Prose that still sends a reader to the frozen mirror. Returns "<file>:<line>"
 * for each instruction to apply / run / paste one of those files.
 */
export function mirrorInstructions(root = process.cwd(), files: string[]): string[] {
  const hits: string[] = [];
  const instruct = /(apply|run|paste|execute)[^.\n]{0,80}scripts\/migrations\/|scripts\/migrations\/[^\s`)]*\.sql[^.\n]{0,60}(in the Supabase SQL editor|sql editor)/i;
  for (const rel of files) {
    if (MIRROR_PROSE_ALLOWED.includes(rel)) continue;
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) continue;
    fs.readFileSync(full, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (instruct.test(line)) hits.push(`${rel}:${i + 1}`);
      });
  }
  return hits;
}

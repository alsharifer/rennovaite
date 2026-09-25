import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkFrozenMirror, checkMigrations, FROZEN_COUNT, listMigrations, mirrorInstructions, readManifest } from "@/lib/migrations/history";

// Migration history is append-only. The Supabase CLI stops a version running
// twice; nothing stops a file being EDITED after it ran, which leaves every
// database that already applied it holding statements the repo no longer shows.
// That drift is silent and permanent, so it is worth a test rather than a
// convention.
describe("migration history", () => {
  const result = checkMigrations(process.cwd());

  it("has migrations to check", () => {
    expect(result.checked).toBeGreaterThan(0);
  });

  it("no tracked migration has been edited or deleted", () => {
    expect(result.errors).toEqual([]);
  });

  it("every migration on disk is recorded in the manifest", () => {
    // A new migration is fine — but it must be registered, or the next edit to
    // it goes unnoticed. `node scripts/update-migration-manifest.mjs` adds it.
    expect(result.untracked).toEqual([]);
  });
});

// T6 housekeeping: `scripts/migrations/` is the frozen historical record and
// `supabase/migrations/` is the one live source of truth. The mirror stopping at
// 030 is by design — these tests keep it that way, and keep the repo from
// telling anyone to run a file out of it.
describe("the frozen mirror is retired, not drifting", () => {
  const mirror = checkFrozenMirror(process.cwd());

  it("holds exactly the thirty hand-applied migrations plus its README", () => {
    expect(mirror.frozen).toHaveLength(FROZEN_COUNT);
    expect(mirror.errors).toEqual([]);
  });

  it("every frozen file maps to a migration that exists in the live directory", () => {
    const manifest = readManifest(process.cwd());
    const mapped = manifest.migrations.filter((m) => m.legacy).map((m) => m.legacy!);
    expect(mapped.sort()).toEqual([...mirror.frozen].sort());
  });

  it("the live directory has carried on past the mirror", () => {
    const live = listMigrations(process.cwd());
    expect(live.length).toBeGreaterThan(FROZEN_COUNT);
  });

  it("nothing in the app, the scripts or the docs tells anyone to run one", () => {
    const files = [
      ...walkRepo("app"),
      ...walkRepo("lib"),
      ...walkRepo("scripts").filter((f) => !f.startsWith("scripts/migrations/")),
      ...walkRepo("docs"),
      "CLAUDE.md",
      "AGENTS.md",
      "SPRINT_ADDENDUM.md",
      "PLATFORM_STATUS.md",
    ];
    expect(mirrorInstructions(process.cwd(), files)).toEqual([]);
  });
});

function walkRepo(dir: string, out: string[] = []): string[] {
  const root = process.cwd();
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return out;
  for (const name of fs.readdirSync(full)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const rel = `${dir}/${name}`;
    if (fs.statSync(path.join(root, rel)).isDirectory()) walkRepo(rel, out);
    else if (/\.(tsx?|mjs|md|json)$/.test(name)) out.push(rel);
  }
  return out;
}

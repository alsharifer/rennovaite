import { describe, expect, it } from "vitest";

import { checkMigrations } from "@/lib/migrations/history";

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

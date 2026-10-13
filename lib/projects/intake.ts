// =============================================================================
// lib/projects/intake.ts — the intake's project, from upload to Continue
// (K11 #1, spec §7; migration 056).
//
// Uploading a plan on /project/new creates the project at once (the parse needs
// a row), usually before the owner has typed its name — the walkthrough found it
// on Projects as "Untitled". Now:
//
//   upload    the completion carries the typed name and city when there are any
//             (`intakeFields`), and the project starts as a DRAFT (draft_since);
//   Continue  `finishIntake` writes the name and city the form holds at that
//             moment and clears the draft — the project appears on Projects;
//   abandoned a draft is hidden from Projects and the switcher (`withoutDrafts`);
//             the daily purge job soft-deletes drafts older than 24 h
//             (`sweepIntakeDrafts` — deleted_at, reversible, not listed in
//             Recently deleted), and the 30-day purge takes them from there.
//
// Every read tolerates a database without 056 (nothing is a draft there).
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export const DRAFT_TTL_HOURS = 24;
const HOUR_MS = 3_600_000;
export const DEFAULT_PROJECT_NAME = "Untitled";
export const DEFAULT_CITY = "Dubai";

const isMissingDraftColumn = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42703" || e.code === "PGRST204" || /draft_since|schema cache/i.test(e.message ?? ""));

/** The name and city an intake completion may carry: trimmed, bounded, absent when blank. */
export function intakeFields(f: { name?: unknown; city?: unknown }): { name: string | null; city: string | null } {
  const clean = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : null);
  return { name: clean(f.name, 200), city: clean(f.city, 80) };
}

/** The row an intake plan upload inserts: the typed name / city (else the defaults), as a draft. */
export function draftProjectRow(f: { name?: unknown; city?: unknown }, now = new Date()): { name: string; city: string; draft_since: string } {
  const { name, city } = intakeFields(f);
  return { name: name ?? DEFAULT_PROJECT_NAME, city: city ?? DEFAULT_CITY, draft_since: now.toISOString() };
}

/** Insert the intake's project — as a draft, or (before 056) as a plain project. */
export async function insertIntakeProject(db: SupabaseClient, f: { name?: unknown; city?: unknown }): Promise<{ id: string }> {
  const row = draftProjectRow(f);
  let res = await db.from("projects").insert(row).select("id").single<{ id: string }>();
  if (res.error && isMissingDraftColumn(res.error)) {
    const { draft_since: _d, ...pre056 } = row;
    void _d;
    res = await db.from("projects").insert(pre056).select("id").single<{ id: string }>();
  }
  if (res.error || !res.data) throw res.error ?? new Error("Failed to create project row.");
  return res.data;
}

/**
 * Continue on the intake: the name and city the form holds now, and the project
 * is no longer a draft. The caller is a project member (the route checked). A
 * blank name keeps the stored one; a project renamed since keeps its display name.
 */
export async function finishIntake(db: SupabaseClient, projectId: string, f: { name?: unknown; city?: unknown }): Promise<{ name: string; city: string }> {
  const { name, city } = intakeFields(f);
  const { data: cur, error: readErr } = await db.from("projects").select("name, city, display_name").eq("id", projectId).maybeSingle<{ name: string | null; city: string | null; display_name: string | null }>();
  if (readErr) throw new Error(`project read failed: ${readErr.message}`);
  if (!cur) throw new Error("project not found");
  const patch: Record<string, unknown> = { draft_since: null };
  if (name) patch[cur.display_name ? "display_name" : "name"] = name;
  if (city) patch.city = city;
  let { error } = await db.from("projects").update(patch).eq("id", projectId);
  if (error && isMissingDraftColumn(error)) {
    const { draft_since: _d, ...pre056 } = patch;
    void _d;
    ({ error } = await db.from("projects").update(pre056).eq("id", projectId));
  }
  if (error) throw new Error(`project update failed: ${error.message}`);
  return { name: name ?? cur.display_name ?? cur.name ?? DEFAULT_PROJECT_NAME, city: city ?? cur.city ?? DEFAULT_CITY };
}

/** The ids that are drafts, among these. */
export async function draftsAmong(db: SupabaseClient, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await db.from("projects").select("id, draft_since").in("id", [...ids]);
  if (error) {
    if (isMissingDraftColumn(error)) return new Set();
    throw new Error(`projects read failed: ${error.message}`);
  }
  return new Set(((data ?? []) as { id: string; draft_since?: string | null }[]).filter((r) => !!r.draft_since).map((r) => r.id));
}

/** Projects as a list shows them: drafts left out. */
export async function withoutDrafts(db: SupabaseClient, ids: readonly string[]): Promise<string[]> {
  const drafts = await draftsAmong(db, ids);
  return ids.filter((id) => !drafts.has(id));
}

/**
 * The daily clean-up: drafts older than 24 h are soft-deleted (deleted_at, no
 * deleted_by — nobody deleted them). Reversible, and always applied: nothing
 * leaves the database here; the 30-day purge (PROJECT_PURGE_APPLY) decides that.
 */
export async function sweepIntakeDrafts(db: SupabaseClient, opts: { now?: Date } = {}): Promise<string[]> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - DRAFT_TTL_HOURS * HOUR_MS).toISOString();
  const { data, error } = await db.from("projects").select("id").not("draft_since", "is", null).lt("draft_since", cutoff).is("deleted_at", null);
  if (error) {
    if (isMissingDraftColumn(error)) return [];
    throw new Error(`projects read failed: ${error.message}`);
  }
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return [];
  const { error: upErr } = await db.from("projects").update({ deleted_at: now.toISOString() }).in("id", ids);
  if (upErr) throw new Error(`draft sweep failed: ${upErr.message}`);
  return ids;
}

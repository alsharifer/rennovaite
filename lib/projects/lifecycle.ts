// =============================================================================
// lib/projects/lifecycle.ts — rename · archive · delete · restore · purge
// (K10 #1, spec §6.12, migration 055). SERVER-ONLY.
//
// WHO
//   rename / archive / restore   any member of the project (as archive was)
//   delete / delete now          an OWNER project (no firm) → its creator;
//                                a FIRM project → an admin of that firm.
//                                Everyone else: refused with the reason the
//                                menu shows ("Only a firm admin can delete
//                                this project").
//
// DELETE IS SOFT. `deleted_at` / `deleted_by` hide the project from everyone
// on it: lib/projects/access.ts answers a deleted project as not found on
// every route and page (the same 404 as a project that does not exist). It
// sits in "Recently deleted" for PURGE_AFTER_DAYS, then the daily purge
// (/api/cron/projects-purge) removes it — its rows (the FK graph cascades
// from `projects`) AND its Storage objects, which a row delete used to leave
// behind. "Delete now" runs the same purge at once, for the same roles, after
// the name is typed again. Purge logs ids and counts, never names.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Caller } from "@/lib/auth/caller";
import { ASSET_BUCKET } from "@/lib/assets/load";
import { PACK_BUCKET } from "@/lib/documents/pack-export/job";
import { StoreError } from "@/lib/store-error";
import { DOWNLOADS_PREFIX } from "@/lib/uploads/limits";
import { UPLOAD_BUCKET } from "@/lib/uploads/server";
import { walk } from "@/lib/uploads/sweep";

export const PURGE_AFTER_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export const DELETE_REFUSED_FIRM = "Only a firm admin can delete this project";
export const DELETE_REFUSED_OWNER = "Only the person who created this project can delete it";

const isMissingColumn = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42703" || e.code === "PGRST204" || /deleted_at|created_by|role|schema cache|does not exist/i.test(e.message ?? ""));

interface ProjectRow {
  id: string;
  name: string | null;
  display_name: string | null;
  firm_id: string | null;
  created_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
}

/** The name a person sees for a project — the list's name, and the one the dialog asks to type. */
export const shownName = (p: { name: string | null; display_name: string | null }) => (p.display_name || p.name || "Untitled project").trim();

/** The name gate: case-insensitive, trimmed (spec §6.12). */
export const nameMatches = (typed: string, name: string) => typed.trim().toLowerCase() === name.trim().toLowerCase() && name.trim().length > 0;

async function loadProject(db: SupabaseClient, projectId: string): Promise<ProjectRow | null> {
  const { data, error } = await db.from("projects").select("id, name, display_name, firm_id, created_by, deleted_at, deleted_by").eq("id", projectId).maybeSingle<ProjectRow>();
  if (error) {
    if (isMissingColumn(error)) throw new StoreError(500, "migration_required", "Deleting projects needs migration 055 — apply it with npm run db:push.");
    throw new Error(`project read failed: ${error.message}`);
  }
  return data;
}

/** Membership regardless of deletion — the one place a deleted project is still visible (restore, Recently deleted). */
async function isMemberIncludingDeleted(db: SupabaseClient, projectId: string, userId: string): Promise<boolean> {
  const { data, error } = await db.from("project_members").select("project_id").eq("project_id", projectId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`project_members read failed: ${error.message}`);
  return !!data;
}

async function isFirmAdmin(db: SupabaseClient, firmId: string, userId: string): Promise<boolean> {
  const { data, error } = await db.from("firm_members").select("role").eq("firm_id", firmId).eq("user_id", userId).maybeSingle<{ role: string | null }>();
  if (error) {
    if (isMissingColumn(error)) return false; // pre-055: no admins yet — fail closed
    throw new Error(`firm_members read failed: ${error.message}`);
  }
  return data?.role === "admin";
}

export interface DeletePermission {
  allowed: boolean;
  /** Why not, in the words the menu shows. */
  reason: string | null;
}

/** May this caller delete this project? Pure over the loaded facts. */
export function deletePermissionOf(p: { firm_id: string | null; created_by: string | null }, callerId: string, firmAdmin: boolean): DeletePermission {
  if (p.firm_id) return firmAdmin ? { allowed: true, reason: null } : { allowed: false, reason: DELETE_REFUSED_FIRM };
  return p.created_by === callerId ? { allowed: true, reason: null } : { allowed: false, reason: DELETE_REFUSED_OWNER };
}

export async function deletePermission(db: SupabaseClient, projectId: string, caller: Caller): Promise<DeletePermission> {
  const p = await loadProject(db, projectId);
  if (!p) return { allowed: false, reason: "No such project." };
  return deletePermissionOf(p, caller.id, p.firm_id ? await isFirmAdmin(db, p.firm_id, caller.id) : false);
}

/** One read of the firms the caller administers, for a list of projects (the home's menus). */
export async function deletePermissionsFor(db: SupabaseClient, caller: Caller, projects: { id: string; firm_id: string | null; created_by?: string | null }[]): Promise<Map<string, DeletePermission>> {
  let adminOf = new Set<string>();
  if (projects.some((p) => p.firm_id)) {
    const { data, error } = await db.from("firm_members").select("firm_id, role").eq("user_id", caller.id);
    if (!error) adminOf = new Set(((data ?? []) as { firm_id: string; role?: string | null }[]).filter((r) => r.role === "admin").map((r) => r.firm_id));
  }
  return new Map(projects.map((p) => [p.id, deletePermissionOf({ firm_id: p.firm_id, created_by: p.created_by ?? null }, caller.id, !!p.firm_id && adminOf.has(p.firm_id))]));
}

/** The hub top bar's menu: the project as the menu needs it. Members only (the page has authorised). */
export async function projectActionFacts(db: SupabaseClient, projectId: string, caller: Caller): Promise<{ id: string; name: string; archived: boolean; deletable: DeletePermission } | null> {
  const { data } = await db.from("projects").select("*").eq("id", projectId).maybeSingle<ProjectRow & { archived_at?: string | null }>();
  if (!data || data.deleted_at) return null;
  const perm = (await deletePermissionsFor(db, caller, [data])).get(projectId)!;
  return { id: projectId, name: shownName(data), archived: !!data.archived_at, deletable: perm };
}

/** 401 → 404 (missing, or not a member — never confirm a project exists) for the lifecycle routes, deleted or not. */
async function requireMember(db: SupabaseClient, projectId: string, caller: Caller | null): Promise<ProjectRow> {
  if (!caller) throw new StoreError(401, "unauthenticated", "Sign in to work on a project.");
  const p = await loadProject(db, projectId);
  if (!p || !(await isMemberIncludingDeleted(db, projectId, caller.id))) throw new StoreError(404, "project_not_found", "No such project.");
  return p;
}

async function requireDeleter(db: SupabaseClient, projectId: string, caller: Caller | null): Promise<ProjectRow> {
  const p = await requireMember(db, projectId, caller);
  const perm = deletePermissionOf(p, caller!.id, p.firm_id ? await isFirmAdmin(db, p.firm_id, caller!.id) : false);
  if (!perm.allowed) throw new StoreError(403, "not_allowed_to_delete", perm.reason ?? "Not allowed.");
  return p;
}

// --- What a delete takes with it (the confirm dialog's list) --------------------------------

export interface DeletePreview {
  name: string;
  permission: DeletePermission;
  counts: { revisions: number; renders: number; uploads: number; proposals: number };
  /** A proposal left this project for a client: the dialog warns and offers the pack. */
  proposalIssued: boolean;
  /** Where the latest pack's downloads are (06 Documents). */
  packHref: string | null;
}

async function count(db: SupabaseClient, table: string, projectId: string): Promise<number> {
  const { count: n, error } = await db.from(table).select("id", { count: "exact", head: true }).eq("project_id", projectId);
  if (error) return 0; // a table a pre-migration database lacks counts as nothing to delete
  return n ?? 0;
}

export async function deletePreview(db: SupabaseClient, projectId: string, caller: Caller | null): Promise<DeletePreview> {
  const p = await requireMember(db, projectId, caller);
  if (p.deleted_at) throw new StoreError(404, "project_not_found", "No such project.");
  const [revisions, renders, approved, uploads, packs] = await Promise.all([
    count(db, "boqs", projectId),
    count(db, "renders", projectId),
    count(db, "approved_designs", projectId),
    count(db, "project_assets", projectId),
    db
      .from("pack_exports")
      .select("id, options")
      .eq("project_id", projectId)
      .eq("status", "passed")
      .then((r) => (r.error ? [] : ((r.data ?? []) as { id: string; options: { proposal?: boolean } | null }[]))),
  ]);
  const proposals = packs.filter((j) => j.options?.proposal).length;
  return {
    name: shownName(p),
    permission: deletePermissionOf(p, caller!.id, p.firm_id ? await isFirmAdmin(db, p.firm_id, caller!.id) : false),
    counts: { revisions, renders: renders + approved, uploads, proposals },
    proposalIssued: proposals > 0,
    packHref: packs.length > 0 ? `/project/${projectId}/drawings#pack` : null,
  };
}

// --- Soft delete · restore ---------------------------------------------------------------------

export async function softDeleteProject(db: SupabaseClient, projectId: string, caller: Caller | null, confirmName: string): Promise<{ deleted_at: string; purge_on: string }> {
  const p = await requireDeleter(db, projectId, caller);
  if (p.deleted_at) throw new StoreError(404, "project_not_found", "No such project.");
  if (!nameMatches(confirmName, shownName(p))) throw new StoreError(422, "name_mismatch", "Type the project name to confirm.");
  const deleted_at = new Date().toISOString();
  const { error } = await db.from("projects").update({ deleted_at, deleted_by: caller!.id }).eq("id", projectId).is("deleted_at", null);
  if (error) throw new Error(`soft delete failed: ${error.message}`);
  return { deleted_at, purge_on: new Date(Date.parse(deleted_at) + PURGE_AFTER_DAYS * DAY_MS).toISOString() };
}

/** Restore: exactly as it was — the row is untouched by a soft delete, so clearing the mark is the whole restore. */
export async function restoreProject(db: SupabaseClient, projectId: string, caller: Caller | null): Promise<void> {
  const p = await requireMember(db, projectId, caller);
  if (!p.deleted_at) throw new StoreError(409, "not_deleted", "This project is not deleted.");
  const { error } = await db.from("projects").update({ deleted_at: null, deleted_by: null }).eq("id", projectId);
  if (error) throw new Error(`restore failed: ${error.message}`);
}

// --- Recently deleted -------------------------------------------------------------------------

export interface DeletedProject {
  id: string;
  name: string;
  deletedAt: string;
  /** "J. Demo" — the deleter's e-mail local part, for the firm's own eyes; null when unknown. */
  deletedBy: string | null;
  purgeOn: string;
  canDeleteNow: boolean;
}

export async function listRecentlyDeleted(db: SupabaseClient, caller: Caller): Promise<DeletedProject[]> {
  const { data: m, error: me } = await db.from("project_members").select("project_id").eq("user_id", caller.id);
  if (me) throw new Error(`project_members read failed: ${me.message}`);
  const ids = ((m ?? []) as { project_id: string }[]).map((r) => r.project_id);
  if (ids.length === 0) return [];
  // `*`: draft_since arrives with 056. A swept intake draft (K11 #1) was never seen by anyone — not listed.
  const { data, error } = await db.from("projects").select("*").in("id", ids).not("deleted_at", "is", null);
  if (error) {
    if (isMissingColumn(error)) return [];
    throw new Error(`projects read failed: ${error.message}`);
  }
  const rows = ((data ?? []) as (ProjectRow & { draft_since?: string | null })[]).filter((p) => !p.draft_since);
  const out: DeletedProject[] = [];
  for (const p of rows) {
    const admin = p.firm_id ? await isFirmAdmin(db, p.firm_id, caller.id) : false;
    out.push({
      id: p.id,
      name: shownName(p),
      deletedAt: p.deleted_at!,
      deletedBy: p.deleted_by ? (p.deleted_by === caller.id ? "You" : await deleterLabel(db, p.deleted_by)) : null,
      purgeOn: new Date(Date.parse(p.deleted_at!) + PURGE_AFTER_DAYS * DAY_MS).toISOString(),
      canDeleteNow: deletePermissionOf(p, caller.id, admin).allowed,
    });
  }
  return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

async function deleterLabel(db: SupabaseClient, userId: string): Promise<string | null> {
  try {
    const { data } = await db.auth.admin.getUserById(userId);
    const email = data.user?.email ?? null;
    return email ? email.split("@")[0]! : null;
  } catch {
    return null;
  }
}

// --- Purge: rows AND Storage -----------------------------------------------------------------

/** Every Storage prefix a project writes under (the map in docs/K_BACKLOG.md → K10 #1). */
export function projectStoragePrefixes(projectId: string): { bucket: string; prefix: string }[] {
  return [
    { bucket: ASSET_BUCKET, prefix: projectId }, // plan, assets, room photos: plan-uploads/<id>/…
    { bucket: "renders", prefix: `projects/${projectId}` }, // renders, scene views, photo pairs
    { bucket: PACK_BUCKET, prefix: `projects/${projectId}` }, // pack outputs
    { bucket: PACK_BUCKET, prefix: `${DOWNLOADS_PREFIX}/${projectId}` }, // staged large downloads
    { bucket: "drawings", prefix: `projects/${projectId}` }, // design-lock drawing archive
    ...["plan", "project_asset", "room_photo"].map((kind) => ({ bucket: UPLOAD_BUCKET, prefix: `pending/${kind}/${projectId}` })), // uploads never completed
  ];
}

export interface PurgeResult {
  projectId: string;
  objects: number;
  byBucket: Record<string, number>;
}

/** Remove a project's Storage objects, then its row (the FK graph cascades). Logged by id and counts only. */
export async function purgeProject(db: SupabaseClient, projectId: string, opts: { apply: boolean }): Promise<PurgeResult> {
  const byBucket: Record<string, number> = {};
  const found: { bucket: string; path: string }[] = [];
  for (const { bucket, prefix } of projectStoragePrefixes(projectId)) {
    let objs: { path: string }[] = [];
    try {
      objs = await walk(db, bucket, prefix);
    } catch {
      objs = []; // a bucket this environment does not have holds nothing of the project's
    }
    byBucket[bucket] = (byBucket[bucket] ?? 0) + objs.length;
    for (const o of objs) found.push({ bucket, path: o.path });
  }
  if (opts.apply) {
    for (const bucket of new Set(found.map((f) => f.bucket))) {
      const paths = found.filter((f) => f.bucket === bucket).map((f) => f.path);
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await db.storage.from(bucket).remove(paths.slice(i, i + 100));
        if (error) throw new Error(`remove from ${bucket} failed: ${error.message}`);
      }
    }
    const { error } = await db.from("projects").delete().eq("id", projectId);
    if (error) throw new Error(`project delete failed: ${error.message}`);
  }
  return { projectId, objects: found.length, byBucket };
}

/** "Delete now": the purge at once, for the deleting roles, after the name again — only from Recently deleted. */
export async function deleteNow(db: SupabaseClient, projectId: string, caller: Caller | null, confirmName: string): Promise<PurgeResult> {
  const p = await requireDeleter(db, projectId, caller);
  if (!p.deleted_at) throw new StoreError(409, "not_deleted", "Delete the project first; it can then be removed now from Recently deleted.");
  if (!nameMatches(confirmName, shownName(p))) throw new StoreError(422, "name_mismatch", "Type the project name to confirm.");
  const r = await purgeProject(db, projectId, { apply: true });
  console.log(`[projects/delete-now] project=${projectId} objects=${r.objects} ${JSON.stringify(r.byBucket)}`);
  return r;
}

export interface PurgeReport {
  apply: boolean;
  cutoff: string;
  projects: PurgeResult[];
}

/** The daily job: every project deleted more than PURGE_AFTER_DAYS ago. Dry-run unless `apply`. */
export async function purgeExpiredProjects(db: SupabaseClient, opts: { apply: boolean; now?: Date }): Promise<PurgeReport> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - PURGE_AFTER_DAYS * DAY_MS).toISOString();
  const { data, error } = await db.from("projects").select("id").not("deleted_at", "is", null).lt("deleted_at", cutoff);
  if (error) {
    if (isMissingColumn(error)) return { apply: opts.apply, cutoff, projects: [] };
    throw new Error(`projects read failed: ${error.message}`);
  }
  const projects: PurgeResult[] = [];
  for (const { id } of (data ?? []) as { id: string }[]) projects.push(await purgeProject(db, id, { apply: opts.apply }));
  return { apply: opts.apply, cutoff, projects };
}

/** Record who created a project (055) — best-effort, so a pre-055 database still creates projects. */
export async function recordProjectCreator(db: SupabaseClient, projectId: string, userId: string): Promise<void> {
  const { error } = await db.from("projects").update({ created_by: userId }).eq("id", projectId);
  if (error && !isMissingColumn(error)) console.warn(`[projects] created_by not recorded: ${error.message}`);
}

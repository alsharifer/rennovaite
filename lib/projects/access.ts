// =============================================================================
// lib/projects/access.ts — who may touch a project (H5, migration 050).
//
// project_members (project_id, user_id) mirrors firm_members (U1): creating a
// project makes you a member, and every project-scoped route requires
// membership. Checked in APPLICATION CODE — the routes run on the service role,
// which RLS never sees.
//
// ONE resolver for every route: `authorizeProject(db, caller, refs)` takes every
// id a request carries — a project id, a plan, room, render, asset, BoQ,
// fixture, element, opening, context footprint, moodboard item, prediction —
// resolves EACH to the project it belongs to, and answers, in U1's order:
//
//   401 unauthenticated        nobody signed in — before anything is looked up
//   404 <kind>_not_found       an id that does not exist
//   403 not_a_project_member   an id in a project the caller is not a member of
//   400 refs_span_projects     ids from two projects the caller belongs to both of
//
// Checking only the project id a request NAMES is not enough: a caller could
// name their own project and pass another project's room or render beside it.
// Every reference is resolved, so a request is allowed only when everything it
// touches lies in one project the caller is a member of.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Caller } from "@/lib/auth/caller";
import { StoreError } from "@/lib/store-error";

export { StoreError };

/** Every kind of id a project-scoped request can carry. */
export interface ProjectRefs {
  project_id?: string | null;
  plan_id?: string | null;
  room_id?: string | null;
  render_id?: string | null;
  asset_id?: string | null;
  boq_id?: string | null;
  fixture_id?: string | null;
  element_id?: string | null;
  opening_id?: string | null;
  context_id?: string | null;
  moodboard_item_id?: string | null;
  prediction_id?: string | null;
}

type RefKind = keyof ProjectRefs;

const isMissingTable = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /project_members/.test(e.message ?? "") && /does not exist|schema cache/.test(e.message ?? ""));

function requireCaller(caller: Caller | null): Caller {
  if (!caller) throw new StoreError(401, "unauthenticated", "Sign in to work on a project.");
  return caller;
}

async function one<T>(q: PromiseLike<{ data: T | null; error: { message: string } | null }>, what: string): Promise<T | null> {
  const { data, error } = await q;
  if (error) throw new Error(`${what} read failed: ${error.message}`);
  return data;
}

async function projectOfPlan(db: SupabaseClient, planId: string): Promise<string | null> {
  const row = await one(db.from("plans").select("project_id").eq("id", planId).maybeSingle<{ project_id: string | null }>(), "plan");
  return row?.project_id ?? null;
}

/** The project a single reference belongs to, or null when the id does not exist. */
async function resolveRef(db: SupabaseClient, kind: RefKind, id: string): Promise<string | null> {
  switch (kind) {
    case "project_id":
      return (await one(db.from("projects").select("id").eq("id", id).maybeSingle<{ id: string }>(), "project"))?.id ?? null;
    case "plan_id":
      return projectOfPlan(db, id);
    case "room_id": {
      const r = await one(db.from("rooms").select("plan_id").eq("id", id).maybeSingle<{ plan_id: string | null }>(), "room");
      return r?.plan_id ? projectOfPlan(db, r.plan_id) : null;
    }
    case "render_id":
      return (await one(db.from("renders").select("project_id").eq("id", id).maybeSingle<{ project_id: string | null }>(), "render"))?.project_id ?? null;
    case "prediction_id":
      return (await one(db.from("renders").select("project_id").eq("prediction_id", id).limit(1).maybeSingle<{ project_id: string | null }>(), "render"))?.project_id ?? null;
    case "asset_id":
      return (await one(db.from("project_assets").select("project_id").eq("id", id).maybeSingle<{ project_id: string | null }>(), "asset"))?.project_id ?? null;
    case "boq_id":
      return (await one(db.from("boqs").select("project_id").eq("id", id).maybeSingle<{ project_id: string | null }>(), "boq"))?.project_id ?? null;
    case "fixture_id":
      return (await one(db.from("plan_fixtures").select("project_id").eq("id", id).maybeSingle<{ project_id: string | null }>(), "fixture"))?.project_id ?? null;
    case "moodboard_item_id":
      return (await one(db.from("moodboard_items").select("project_id").eq("id", id).maybeSingle<{ project_id: string | null }>(), "moodboard item"))?.project_id ?? null;
    case "element_id":
    case "opening_id":
    case "context_id": {
      const table = kind === "element_id" ? "plan_elements" : kind === "opening_id" ? "plan_openings" : "plan_context";
      const r = await one(db.from(table).select("plan_id").eq("id", id).maybeSingle<{ plan_id: string | null }>(), table);
      return r?.plan_id ? projectOfPlan(db, r.plan_id) : null;
    }
  }
}

const NOT_FOUND: Record<RefKind, string> = {
  project_id: "project",
  plan_id: "plan",
  room_id: "room",
  render_id: "render",
  prediction_id: "render",
  asset_id: "asset",
  boq_id: "boq",
  fixture_id: "fixture",
  element_id: "element",
  opening_id: "opening",
  context_id: "context",
  moodboard_item_id: "moodboard_item",
};

export async function isProjectMember(db: SupabaseClient, projectId: string, userId: string): Promise<boolean> {
  const { data, error } = await db.from("project_members").select("project_id").eq("project_id", projectId).eq("user_id", userId).maybeSingle();
  if (error) {
    if (isMissingTable(error)) throw new StoreError(500, "migration_required", "Project membership is not migrated yet (050) — nothing project-scoped is served until it is.");
    throw new Error(`project_members read failed: ${error.message}`);
  }
  return !!data;
}

/** The projects a user is a member of (the dashboard lists these, and nothing else). */
export async function memberProjectIds(db: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await db.from("project_members").select("project_id").eq("user_id", userId);
  if (error) {
    if (isMissingTable(error)) throw new StoreError(500, "migration_required", "Project membership is not migrated yet (050).");
    throw new Error(`project_members read failed: ${error.message}`);
  }
  return ((data ?? []) as { project_id: string }[]).map((r) => r.project_id);
}

/** Creating a project makes the creator a member (idempotent). */
export async function addProjectMember(db: SupabaseClient, projectId: string, userId: string): Promise<void> {
  const { error } = await db.from("project_members").insert({ project_id: projectId, user_id: userId });
  if (error && (error as { code?: string }).code !== "23505") throw new Error(`project_members insert failed: ${error.message}`);
}

/**
 * The one check. Resolves every reference, then: 404 for any id that does not
 * exist, 403 unless the caller is a member of every project they resolve to,
 * 400 if they resolve to more than one. Returns the project id.
 */
export async function authorizeProject(db: SupabaseClient, caller: Caller | null, refs: ProjectRefs): Promise<string> {
  const who = requireCaller(caller);
  const given = (Object.entries(refs) as [RefKind, string | null | undefined][]).filter((e): e is [RefKind, string] => typeof e[1] === "string" && e[1].length > 0);
  if (given.length === 0) throw new Error("authorizeProject: no project reference given");

  const projects = new Set<string>();
  for (const [kind, id] of given) {
    const projectId = await resolveRef(db, kind, id);
    if (!projectId) throw new StoreError(404, `${NOT_FOUND[kind]}_not_found`, `No such ${NOT_FOUND[kind].replace("_", " ")}.`);
    projects.add(projectId);
  }
  for (const projectId of projects) {
    if (!(await isProjectMember(db, projectId, who.id))) {
      throw new StoreError(403, "not_a_project_member", "You are not a member of this project.");
    }
  }
  if (projects.size > 1) throw new StoreError(400, "refs_span_projects", "The request refers to more than one project.");
  return [...projects][0]!;
}

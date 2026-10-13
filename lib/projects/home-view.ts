// =============================================================================
// lib/projects/home-view.ts — the Projects home, read for one caller (K8 #1,
// spec §6.1). SERVER-ONLY: the estimate reaches the provenance module.
//
// The caller's projects (H5 membership), each with:
//   estimate  the latest stored revision's headline (lib/hub/estimate.ts — the
//             hub's own numbers: ≈, *, the weakest counted mark)
//   next      the rail's first Attention / Blocked step (loadProjectJourney —
//             the gates the rail runs, nothing of its own)
//   stage     lib/projects/home.ts over the same step states
//   thumb     the latest locked view (approved_designs → its render)
// plus up to six recent things that happened, each from a stored record
// (revisions, approvals, passed exports).
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Caller } from "@/lib/auth/caller";
import type { RevisionBoq } from "@/lib/boq/revision-diff";
import { formatAED } from "@/lib/format/aed";
import { listFirms } from "@/lib/firms/store";
import { estimateOf } from "@/lib/hub/estimate";
import { journeyFlagsFromEnv, ownerStepHref, FIRM_STEPS, type OwnerStepKey } from "@/lib/journey";
import { loadProjectJourney } from "@/lib/journey-facts";
import { loadProvenanceContext } from "@/lib/provenance/load";
import { memberProjectIds } from "@/lib/projects/access";
import { deletePermissionsFor, listRecentlyDeleted, type DeletePermission } from "@/lib/projects/lifecycle";

import { homeNext, homeStage, shortDate, type HomeActivity, type HomeRow, type HomeView } from "./home";

async function safe<T>(fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

type ProjectRow = { id: string; name: string | null; display_name: string | null; city: string | null; status: string | null; created_at: string; firm_id: string | null; created_by?: string | null };

function scopeOf(rooms: { unroofed: boolean | null }[]): string | null {
  if (rooms.length === 0) return null;
  const outdoor = rooms.filter((r) => r.unroofed).length;
  return outdoor === 0 ? "Interior refit" : outdoor === rooms.length ? "Garden" : "Interior and garden";
}

const latestIso = (...xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x).reduce((a, b) => (a > b ? a : b), "");

async function loadRow(db: SupabaseClient, p: ProjectRow, caller: Caller, firms: { id: string; name: string }[], archived: boolean, deletable: DeletePermission): Promise<HomeRow> {
  const flags = journeyFlagsFromEnv();
  const [journey, boqs, plan, approved, render] = await Promise.all([
    loadProjectJourney(db, p.id, caller, firms),
    safe([] as { id: string; created_at: string; sections: RevisionBoq }[], async () => {
      const { data } = await db.from("boqs").select("id, created_at, sections").eq("project_id", p.id).order("created_at", { ascending: false }).limit(1);
      return (data ?? []) as { id: string; created_at: string; sections: RevisionBoq }[];
    }),
    safe(null as { id: string; created_at: string } | null, async () => (await db.from("plans").select("id, created_at").eq("project_id", p.id).order("created_at", { ascending: false }).limit(1).maybeSingle()).data as { id: string; created_at: string } | null),
    safe(null as { render_id: string | null; created_at: string } | null, async () => (await db.from("approved_designs").select("render_id, created_at").eq("project_id", p.id).order("created_at", { ascending: false }).limit(1).maybeSingle()).data as { render_id: string | null; created_at: string } | null),
    safe(null as { created_at: string } | null, async () => (await db.from("renders").select("created_at").eq("project_id", p.id).order("created_at", { ascending: false }).limit(1).maybeSingle()).data as { created_at: string } | null),
  ]);
  const latest = boqs[0] ?? null;
  const [rooms, thumb, estimate] = await Promise.all([
    plan ? safe([] as { unroofed: boolean | null }[], async () => ((await db.from("rooms").select("unroofed").eq("plan_id", plan.id)).data ?? []) as { unroofed: boolean | null }[]) : Promise.resolve([]),
    approved?.render_id
      ? safe(null as string | null, async () => ((await db.from("renders").select("image_url").eq("id", approved.render_id!).maybeSingle()).data as { image_url: string | null } | null)?.image_url ?? null)
      : Promise.resolve(null),
    latest ? safe(null, async () => estimateOf(latest.sections, await loadProvenanceContext(db, p.id))) : Promise.resolve(null),
  ]);

  const stepHref = (key: string) =>
    journey.persona === "firm" ? (FIRM_STEPS.find((s) => s.key === key)?.href(p.id) ?? `/project/${p.id}`) : ownerStepHref(key as OwnerStepKey, p.id, flags);
  const scope = scopeOf(rooms);
  return {
    id: p.id,
    name: (p.display_name || p.name || "Untitled project").trim(),
    scope: [scope, p.city].filter(Boolean).join(" · ") || null,
    stage: homeStage({ status: p.status, persona: journey.persona, statuses: journey.statuses, hasBoq: !!latest }),
    rev: journey.boq ? { n: journey.boq.rev, date: shortDate(journey.boq.createdAt) } : null,
    estimate: estimate ? { total: estimate.grand, estimate: estimate.estimate, excludes: estimate.excluded.length, tier: estimate.tier } : null,
    next: homeNext(p.id, journey.persona, journey.statuses, stepHref),
    updatedAt: latestIso(p.created_at, plan?.created_at, latest?.created_at, approved?.created_at, render?.created_at),
    thumb,
    archived,
    deletable,
  };
}

/** Up to six things that happened, newest first — each from a stored record. */
async function loadActivity(db: SupabaseClient, projects: ProjectRow[]): Promise<HomeActivity[]> {
  const ids = projects.map((p) => p.id);
  if (ids.length === 0) return [];
  const name = new Map(projects.map((p) => [p.id, (p.display_name || p.name || "Untitled project").trim()]));
  const [boqs, approvals, exports] = await Promise.all([
    safe([] as { id: string; project_id: string; created_at: string; total_aed: number | null }[], async () => ((await db.from("boqs").select("id, project_id, created_at, total_aed").in("project_id", ids).order("created_at", { ascending: true })).data ?? []) as { id: string; project_id: string; created_at: string; total_aed: number | null }[]),
    safe([] as { boq_id: string; project_id: string; kind: string; created_at: string }[], async () => ((await db.from("boq_approvals").select("boq_id, project_id, kind, created_at").in("project_id", ids).order("created_at", { ascending: false }).limit(12)).data ?? []) as { boq_id: string; project_id: string; kind: string; created_at: string }[]),
    safe([] as { project_id: string; status: string; created_at: string; options: { proposal?: boolean } | null }[], async () => ((await db.from("pack_exports").select("project_id, status, created_at, options").in("project_id", ids).eq("status", "passed").order("created_at", { ascending: false }).limit(12)).data ?? []) as { project_id: string; status: string; created_at: string; options: { proposal?: boolean } | null }[]),
  ]);

  // Revision numbers per project, oldest = rev 1 (the rail and the diff number them this way).
  const revOf = new Map<string, number>();
  const prevTotal = new Map<string, number | null>();
  const out: HomeActivity[] = [];
  const counter = new Map<string, number>();
  for (const b of boqs) {
    const n = (counter.get(b.project_id) ?? 0) + 1;
    counter.set(b.project_id, n);
    revOf.set(b.id, n);
    const before = prevTotal.get(b.project_id);
    const total = b.total_aed == null ? null : Number(b.total_aed);
    const delta = before != null && total != null ? total - before : null;
    const tail = n === 1 ? " — from the plan" : delta == null ? "" : delta === 0 ? " — total unchanged" : ` (${delta > 0 ? "+" : "−"}AED ${formatAED(Math.abs(delta))})`;
    out.push({ text: `rev ${n} generated${tail}`, project: name.get(b.project_id) ?? "", projectId: b.project_id, at: b.created_at });
    prevTotal.set(b.project_id, total);
  }
  for (const a of approvals) {
    const n = revOf.get(a.boq_id);
    out.push({ text: `${a.kind === "client" ? "Client approval recorded" : "Firm approved"}${n ? ` · rev ${n}` : ""}`, project: name.get(a.project_id) ?? "", projectId: a.project_id, at: a.created_at });
  }
  for (const e of exports) {
    out.push({ text: e.options?.proposal ? "Pack exported with the client proposal" : "Pack exported", project: name.get(e.project_id) ?? "", projectId: e.project_id, at: e.created_at });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
}

export async function loadProjectsHome(db: SupabaseClient, caller: Caller): Promise<HomeView> {
  const [ids, firms] = await Promise.all([memberProjectIds(db, caller.id), safe([], () => listFirms(db, caller))]);
  const railFirms = firms.map((f) => ({ id: f.id, name: f.name }));
  // K10: Recently deleted is the caller's too (memberProjectIds already leaves deleted projects out).
  const deleted = await safe([], () => listRecentlyDeleted(db, caller));
  if (ids.length === 0) return { rows: [], counts: { active: 0, onHold: 0, completed: 0, archived: 0 }, activity: [], deleted };

  // `*`: created_by arrives with 055; a database without it still lists projects.
  const { data } = await db.from("projects").select("*").in("id", ids);
  // K11 #1 (056): a draft (an intake upload nobody continued) is not on the list.
  const projects = ((data ?? []) as (ProjectRow & { draft_since?: string | null })[]).filter((p) => !p.draft_since);
  // Archived (migration 030) — read best-effort; archiving hides, never deletes.
  const archived = await safe(new Set<string>(), async () => {
    const { data: a } = await db.from("projects").select("id").in("id", ids).not("archived_at", "is", null);
    return new Set(((a ?? []) as { id: string }[]).map((r) => r.id));
  });

  const perms = await deletePermissionsFor(db, caller, projects);
  const [rows, activity] = await Promise.all([Promise.all(projects.map((p) => loadRow(db, p, caller, railFirms, archived.has(p.id), perms.get(p.id)!))), loadActivity(db, projects.filter((p) => !archived.has(p.id)))]);
  const live = rows.filter((r) => !r.archived);
  return {
    rows,
    counts: {
      active: live.filter((r) => r.stage !== "on_hold" && r.stage !== "completed").length,
      onHold: live.filter((r) => r.stage === "on_hold").length,
      completed: live.filter((r) => r.stage === "completed").length,
      archived: rows.length - live.length,
    },
    activity,
    deleted,
  };
}

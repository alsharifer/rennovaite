// =============================================================================
// lib/journey-facts.ts — what the rail needs, read once per page (K2).
//
// Server-side (never import it into a client component: it reaches the
// identity-curating provenance modules). Runs the gates the app ALREADY runs and hands their outputs to
// the pure lib/journey-state.ts:
//   plan        regenerateReadiness → loadPriceablePlan's refusal (H4)
//   rates       loadProposalGate → book status, reference basis, verdict (L4)
//   upstream    changesSinceRevision — the one "changed since rev N" (U4 causes)
//   approval    listApprovals + approvalStatus on the latest revision (U4)
//   documents   latestPackJobs — a PASSED export after the latest revision (T5)
// plus the persona (a member of the project's firm → firm journey) and the two
// switchers (the caller's firms; the caller's projects with rev + date).
//
// Every read is best-effort: a missing table or a failed read degrades that
// one fact to its neutral value; the rail never takes a page down.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Caller } from "@/lib/auth/caller";
import { approvalStatus, listApprovals } from "@/lib/boq/approvals";
import { regenerateReadiness } from "@/lib/boq/regenerate";
import { changesSinceRevision, summarizeChanges } from "@/lib/boq/changes-since";
import { isUnpricedLine } from "@/lib/documents/boq-derived";
import { latestPackJobs } from "@/lib/documents/pack-export/job";
import { loadProposalGate } from "@/lib/documents/proposal-gate";
import { listFirms } from "@/lib/firms/store";
import { firmStepStatuses, ownerStepStatuses, type JourneyFacts, type PlanBlock, type RailContext, type RailFirm, type RailProject, type StepStatus } from "@/lib/journey-state";
import type { JourneyPersona } from "@/lib/journey";
import { memberProjectIds } from "@/lib/projects/access";
import { withoutDrafts } from "@/lib/projects/intake";
import { renderLockProgress } from "@/lib/render-lock-progress";
import { outOfScopeRoomIds } from "@/lib/plan/scope-load";

const PLAN_CODES = new Set(["no_plan", "no_area", "no_rooms", "plan_has_overlaps", "rooms_unnamed", "not_priceable"]);

async function safe<T>(fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

async function count(db: SupabaseClient, table: string, projectId: string): Promise<number> {
  return safe(0, async () => {
    const { count: n, error } = await db.from(table).select("project_id", { count: "exact", head: true }).eq("project_id", projectId);
    return error ? 0 : (n ?? 0);
  });
}

/** The D4 lines still to be priced on a stored BoQ (isUnpricedLine — the headline's own rule). */
async function unpricedLineCount(db: SupabaseClient, boqId: string): Promise<number> {
  return safe(0, async () => {
    type Section = { lines?: Parameters<typeof isUnpricedLine>[0][] };
    // The `sections` column holds the whole stored BoQ document; its sections are inside it.
    const { data } = await db.from("boqs").select("sections").eq("id", boqId).maybeSingle<{ sections: { sections?: Section[] } | Section[] | null }>();
    const doc = data?.sections;
    const sections = Array.isArray(doc) ? doc : (doc?.sections ?? []);
    return sections.reduce((n, s) => n + (s.lines ?? []).filter(isUnpricedLine).length, 0);
  });
}

/** The caller's projects (H5 membership) with each one's latest revision — the project switcher. */
async function loadRailProjects(db: SupabaseClient, caller: Caller): Promise<RailProject[]> {
  return safe([], async () => {
    // K11 #1: drafts (abandoned intake uploads) are not in the switcher.
    const ids = await withoutDrafts(db, await memberProjectIds(db, caller.id));
    if (ids.length === 0) return [];
    const [{ data: projects }, { data: boqs }] = await Promise.all([
      db.from("projects").select("id, name, display_name, created_at").in("id", ids),
      db.from("boqs").select("project_id, created_at").in("project_id", ids).order("created_at", { ascending: true }),
    ]);
    const revs = new Map<string, { n: number; at: string }>();
    for (const b of boqs ?? []) {
      const cur = revs.get(b.project_id as string);
      revs.set(b.project_id as string, { n: (cur?.n ?? 0) + 1, at: b.created_at as string });
    }
    return (projects ?? [])
      .map((p) => ({
        id: p.id as string,
        name: ((p.display_name as string | null) || (p.name as string | null) || "Untitled project").trim(),
        rev: revs.get(p.id as string)?.n ?? null,
        revAt: revs.get(p.id as string)?.at ?? null,
        created: p.created_at as string,
      }))
      .sort((a, b) => (b.revAt ?? b.created).localeCompare(a.revAt ?? a.created))
      .map((p): RailProject => ({ id: p.id, name: p.name, rev: p.rev, revAt: p.revAt }));
  });
}

/** K10 (055): the caller's firms with their role — the rail footer says "Firm admin" or "Firm member". */
async function railFirmsOf(db: SupabaseClient, caller: Caller, firms: { id: string; name: string }[]): Promise<RailFirm[]> {
  if (firms.length === 0) return [];
  const { data, error } = await db.from("firm_members").select("firm_id, role").eq("user_id", caller.id);
  const admin = new Set(error ? [] : ((data ?? []) as { firm_id: string; role?: string | null }[]).filter((r) => r.role === "admin").map((r) => r.firm_id));
  return firms.map((f) => ({ id: f.id, name: f.name, admin: admin.has(f.id) }));
}

/** The rail for a page with no project (settings, the firm book, quote review). */
export async function loadRailContextWithoutProject(db: SupabaseClient, caller: Caller, opts: { firmId?: string } = {}): Promise<RailContext> {
  const [firms, projects] = await Promise.all([safe([], () => listFirms(db, caller)), loadRailProjects(db, caller)]);
  const railFirms = await railFirmsOf(db, caller, firms);
  const firm = railFirms.find((f) => f.id === opts.firmId) ?? railFirms[0] ?? null;
  return { persona: railFirms.length > 0 ? "firm" : "owner", caller: { email: caller.email }, firms: railFirms, firm, projects, project: null, statuses: {} };
}

/** One project's journey: its persona and every step's status (K8: also read per row by the Projects home). */
export interface ProjectJourney {
  persona: JourneyPersona;
  /** The project's firm, when the caller is a member of it. */
  firm: RailFirm | null;
  statuses: Record<string, StepStatus>;
  /** The latest revision (1-based) and when it was generated — null before the first BoQ. */
  boq: { rev: number; createdAt: string } | null;
}

/**
 * The gates for one project, run as the rail runs them. `firms` are the
 * caller's (listFirms) — passed in so a page that reads many projects lists
 * them once.
 */
export async function loadProjectJourney(db: SupabaseClient, projectId: string, caller: Caller, firms: RailFirm[]): Promise<ProjectJourney> {
  const [projectRow, readiness, specSelections, revCount] = await Promise.all([
    safe(null as null | { firm_id: string | null }, async () => (await db.from("projects").select("firm_id").eq("id", projectId).maybeSingle()).data as { firm_id: string | null } | null),
    safe(null as Awaited<ReturnType<typeof regenerateReadiness>> | null, () => regenerateReadiness(db, projectId, caller)),
    count(db, "accessory_selections", projectId),
    count(db, "boqs", projectId),
  ]);

  const projectFirm = projectRow?.firm_id ? (firms.find((f) => f.id === projectRow.firm_id) ?? null) : null;
  // Persona: a member of the firm this project is attached to works the firm journey.
  const persona: JourneyPersona = projectFirm ? "firm" : "owner";

  const block = readiness?.block && PLAN_CODES.has(readiness.block.code) ? (readiness.block as PlanBlock) : null;
  const latest = readiness?.previous ?? null;
  const boq = latest && revCount ? { rev: revCount, createdAt: latest.created_at } : null;

  const facts: JourneyFacts = {
    projectId,
    planBlock: block,
    boq,
    specSelections,
    owner: { brief: false, moodboardItems: 0, renders: 0, renderViews: { locked: 0, total: 0 }, unpricedLines: 0 },
    firm: null,
  };

  if (persona === "firm") {
    const now = new Date();
    const [gate, upstream, approvals, jobs] = await Promise.all([
      safe(null as Awaited<ReturnType<typeof loadProposalGate>> | null, () => loadProposalGate(db, projectId)),
      latest && boq ? safe(summarizeChanges([], boq.rev), () => changesSinceRevision(db, projectId, latest, boq.rev, now)) : Promise.resolve(summarizeChanges([], 0)),
      safe([], () => listApprovals(db, projectId)),
      safe([], () => latestPackJobs(db, projectId, 10)),
    ]);
    const status = latest ? approvalStatus(approvals, latest.id) : null;
    const passedSince = jobs.filter((j) => j.status === "passed" && latest && j.created_at > latest.created_at);
    facts.firm = {
      bookStatus: gate?.firm?.book_status ?? null,
      basis: gate?.boq ? { referenceLines: gate.boq.basis.reference_lines, totalLines: gate.boq.basis.total_lines } : null,
      gate: gate?.verdict ?? { ok: false, reason: null, refusal: null },
      upstream,
      approval: status ? { firm: !!status.firm, client: !!status.client } : null,
      exported: {
        pack: passedSince.length > 0,
        proposal: passedSince.some((j) => (j.options as { proposal?: boolean } | null)?.proposal === true),
      },
    };
  } else {
    const [brief, moodboardItems, renders, unpricedLines, renderViews] = await Promise.all([
      count(db, "project_briefs", projectId),
      count(db, "moodboard_items", projectId),
      count(db, "renders", projectId),
      latest ? unpricedLineCount(db, latest.id) : Promise.resolve(0),
      // K10: the renderable rooms of the latest plan and the ones with a locked design.
      safe({ locked: 0, total: 0 }, async () => {
        const { data: plan } = await db.from("plans").select("id").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string }>();
        if (!plan) return { locked: 0, total: 0 };
        const [{ data: rooms }, { data: approved }] = await Promise.all([
          db.from("rooms").select("id, room_type").eq("plan_id", plan.id),
          db.from("approved_designs").select("room_id").eq("project_id", projectId),
        ]);
        // B4 (064): a room anchored by a locked photo view is a locked design too (best-effort before 064).
        const ids = ((rooms ?? []) as { id: string }[]).map((r) => r.id);
        const anchored = ids.length ? await db.from("room_anchors").select("room_id").in("room_id", ids) : { data: [] as { room_id: string }[], error: null };
        const lockedIds = [...((approved ?? []) as { room_id: string | null }[]).map((a) => a.room_id), ...(anchored.error ? [] : ((anchored.data ?? []) as { room_id: string }[]).map((a) => a.room_id))];
        // K12: only the rooms in this renovation are views to lock.
        const out = await outOfScopeRoomIds(db, projectId);
        return renderLockProgress(((rooms ?? []) as { id: string; room_type: string | null }[]).filter((r) => !out.has(r.id)), lockedIds.filter((x): x is string => !!x));
      }),
    ]);
    facts.owner = { brief: brief > 0, moodboardItems, renders, renderViews, unpricedLines };
  }

  const statuses = (persona === "firm" ? firmStepStatuses(facts) : ownerStepStatuses(facts)) as Record<string, StepStatus>;
  return { persona, firm: projectFirm, statuses, boq };
}

export async function loadRailContext(db: SupabaseClient, projectId: string, caller: Caller): Promise<RailContext> {
  const [firms, projects] = await Promise.all([safe([], () => listFirms(db, caller)), loadRailProjects(db, caller)]);
  const railFirms = await railFirmsOf(db, caller, firms);
  const journey = await loadProjectJourney(db, projectId, caller, railFirms);
  const project = projects.find((p) => p.id === projectId) ?? { id: projectId, name: "Project", rev: null, revAt: null };
  return { persona: journey.persona, caller: { email: caller.email }, firms: railFirms, firm: journey.firm, projects, project, statuses: journey.statuses };
}

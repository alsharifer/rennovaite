// =============================================================================
// lib/hub/hub-view.ts — 00 Project hub for a firm project, as the screen reads
// it (K5a, R7 §3.1, Figma 11:48). SERVER-ONLY: tierOf() reaches the
// provenance module.
//
// Every figure is a stored one. The estimate is the latest revision's COUNTED
// subtotal — the sum the "Basis of this number" table adds up to, line by line
// by amount mark (R1) — with the project total (contingency + VAT) beside it,
// so the hub and the BoQ page never disagree about which number is which.
// "Next" is the rail's own state (lib/journey-state, read through the rail
// context the shell already loads) — never a rule of its own. Revisions are the
// stored revisions with the diff's own counts and RECORDED causes; documents
// are the gates' own answers.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadRecordedCauses } from "@/lib/boq/revision-causes";
import { CAUSE_KIND_LABEL, diffRevisions, snapshotRevision, type RevisionBoq } from "@/lib/boq/revision-diff";
import { listRevisions } from "@/lib/boq/revisions";
import { packExportEnabled } from "@/lib/documents/pack-export/guard";
import { loadProposalSetup } from "@/lib/documents/proposal-setup";
import { FIRM_STEPS, OWNER_STEPS, journeyFlagsFromEnv, ownerStepHref, type JourneyFlags } from "@/lib/journey";
import type { RailContext } from "@/lib/journey-state";
import { loadProvenanceContext } from "@/lib/provenance/load";
import type { ProvTier } from "@/lib/provenance/tier";

import { estimateOf, type BasisRow } from "./estimate";

export type HubBasisRow = BasisRow;

export interface HubNext {
  step: string;
  title: string;
  sentence: string;
  primary: { label: string; href: string } | null;
  secondary: { label: string; href: string } | null;
}

export interface HubRevision {
  boqId: string;
  rev: number;
  date: string;
  cause: string;
  lines: number | null;
  delta: number | null;
  total: number;
  status: string;
  awaiting: boolean;
}

export interface HubView {
  projectId: string;
  name: string;
  meta: string[];
  estimate: {
    rev: number;
    revDate: string;
    counted: number;
    estimate: boolean;
    tier: ProvTier | null;
    excluded: { ref: string; description: string }[];
    grand: number;
    contingencyPct: number;
    vatPct: number;
    basis: HubBasisRow[];
    countedLines: number;
    /** The stored chain from the counted subtotal to the project total, to the fil (H7). */
    chain: { subtotal: number; ohp: number; contingency: number; vat: number };
    /** Only a client-entered budget on a project with no firm (H7). */
    budget: number | null;
  } | null;
  next: HubNext[];
  revisions: HubRevision[];
  reconciliation: string | null;
  documents: { key: string; label: string; icon: string; state: string; locked: boolean; action: { label: string; href: string } | null }[];
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" });

/**
 * The rail's attention / blocked steps, in journey order, as the hub's Next
 * column (max 3) — the persona's own journey (firm 00–08, or the owner's
 * numbered steps). When nothing needs attention, the first step not yet done is
 * the one next action. Never a rule of its own: state, reason and fix are the
 * rail's (lib/journey-state).
 */
export function nextFromRail(projectId: string, rail: Pick<RailContext, "persona" | "statuses">, flags: JourneyFlags): HubNext[] {
  const statuses = rail.statuses;
  const steps =
    rail.persona === "firm"
      ? FIRM_STEPS.filter((s) => s.key !== "hub").map((s) => ({ key: s.key as string, number: s.number, label: s.label, href: s.href(projectId) }))
      : OWNER_STEPS.filter((s) => s.key !== "overview").map((s) => ({ key: s.key as string, number: s.number, label: s.label, href: ownerStepHref(s.key, projectId, flags) }));
  const out: HubNext[] = [];
  for (const s of steps) {
    const st = statuses[s.key];
    // K10: an available step that states a reason (03 Renders "1 / 3 locked") is next too — the rail and
    // the Projects home say the same.
    if (!st || st.state === "done" || (st.state === "available" && !st.reason)) continue;
    const eyebrow = `${s.number} · ${s.label.toUpperCase()}`;
    const reason = st.reason ?? "";
    let title = st.state === "blocked" ? `${s.label} is blocked` : `${s.label} needs attention`;
    let secondary: HubNext["secondary"] = null;
    if (s.key === "rates_basis") {
      title = "Review rates before client use";
      secondary = { label: "Accept market basis", href: `/project/${projectId}/rates#reference-basis` };
    } else if (s.key === "revisions") {
      title = /client/.test(reason) ? "Client approval outstanding" : "Firm approval outstanding";
      secondary = { label: "Open revision", href: `/project/${projectId}/boq/revisions` };
    } else if (s.key === "boq_review") title = "BoQ out of date";
    else if (s.key === "proposal") title = "Proposal locked";
    else if (s.key === "scope" || s.key === "plan") title = "Plan can't be priced yet";
    else if (s.key === "cost") title = st.state === "blocked" ? "Cost is blocked" : "Some items are not priced";
    else if (s.key === "design") title = "Add references";
    else if (s.key === "renders") title = "Lock the remaining views";
    else if (s.key === "tender") title = "Tender is blocked";
    out.push({ step: eyebrow, title, sentence: reason, primary: st.fix ?? { label: `Open ${s.label}`, href: s.href }, secondary });
    if (out.length === 3) break;
  }
  if (out.length === 0) {
    const first = steps.find((s) => statuses[s.key]?.state === "available");
    if (first) out.push({ step: `${first.number} · ${first.label.toUpperCase()}`, title: `Next: ${first.label}`, sentence: "", primary: { label: `Open ${first.label}`, href: first.href }, secondary: null });
  }
  return out;
}

export async function loadHubView(db: SupabaseClient, projectId: string, rail: RailContext): Promise<HubView> {
  const [{ data: project }, revisions, ctx, setup, plan] = await Promise.all([
    db.from("projects").select("name, display_name, city, budget_aed, firm_id").eq("id", projectId).maybeSingle<{ name: string | null; display_name: string | null; city: string | null; budget_aed: number | null; firm_id: string | null }>(),
    listRevisions(db, projectId),
    loadProvenanceContext(db, projectId),
    loadProposalSetup(db, projectId).catch(() => null),
    db.from("plans").select("id").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string }>(),
  ]);
  const { data: rooms } = plan.data ? await db.from("rooms").select("room_type, unroofed").eq("plan_id", plan.data.id) : { data: [] };
  const roomList = (rooms ?? []) as { room_type: string | null; unroofed: boolean | null }[];
  const outdoor = roomList.filter((r) => r.unroofed).length;
  const indoor = roomList.length - outdoor;
  const scope = roomList.length === 0 ? null : outdoor === 0 ? "Interior refit" : indoor === 0 ? "Garden" : "Interior and garden";

  // The latest revisions' stored documents (newest first), for the estimate and the table.
  const top = revisions.slice(0, 6);
  const { data: docs } = top.length ? await db.from("boqs").select("id, created_at, sections").in("id", top.map((r) => r.boq_id)) : { data: [] };
  const byId = new Map(((docs ?? []) as { id: string; created_at: string; sections: RevisionBoq }[]).map((d) => [d.id, d]));
  const n = revisions.length;

  let estimate: HubView["estimate"] = null;
  const latestDoc = top[0] ? byId.get(top[0].boq_id) : null;
  const meta: string[] = [];
  if (scope) meta.push(`${scope} · ${roomList.length} ${roomList.length === 1 ? "area" : "areas"}`);
  if (setup?.clientLabel) meta.push(`client: ${setup.clientLabel}`);
  if (project?.city) meta.push(project.city);

  if (latestDoc) {
    const e = estimateOf(latestDoc.sections, ctx);
    estimate = {
      rev: n,
      revDate: day(latestDoc.created_at),
      counted: e.counted,
      estimate: e.estimate,
      tier: e.tier,
      excluded: e.excluded,
      grand: e.grand,
      contingencyPct: e.contingencyPct,
      vatPct: e.vatPct,
      chain: e.chain,
      budget: !project?.firm_id && project?.budget_aed ? Number(project.budget_aed) : null,
      basis: e.basis,
      countedLines: e.countedLines,
    };
    if (e.programmeDays) meta.push(`indicative programme ${e.programmeDays} days`);
  }

  // Revisions: the diff's own counts and RECORDED causes between consecutive revisions — never a story.
  const table: HubRevision[] = [];
  for (let i = 0; i < top.length; i++) {
    const r = top[i]!;
    const doc = byId.get(r.boq_id);
    const prev = top[i + 1] ? byId.get(top[i + 1]!.boq_id) : null;
    let cause = i === top.length - 1 && n === top.length ? "BoQ generated from plan" : "—";
    let lines: number | null = null;
    let delta: number | null = null;
    if (doc && prev) {
      const recorded = await loadRecordedCauses(db, projectId, prev.created_at, doc.created_at, doc.id).catch(() => []);
      const d = diffRevisions(snapshotRevision(prev.id, prev.created_at, prev.sections), snapshotRevision(doc.id, doc.created_at, doc.sections), recorded);
      lines = d.counts.moved + d.counts.added + d.counts.removed;
      delta = d.summary.grand.delta;
      const named = d.lines.flatMap((l) => l.causes)[0] ?? d.window_causes.find((c) => c.kind !== "regeneration") ?? null;
      const label = named ? CAUSE_KIND_LABEL[named.kind] : "";
      cause = named ? (named.summary.startsWith(label) ? named.summary : `${label} · ${named.summary}`) : lines === 0 ? "regenerated, nothing moved" : "no cause recorded";
    } else if (doc && !prev && n === top.length) {
      lines = r.line_count;
    }
    const status = r.approvals.client ? `Client approved ${r.approvals.client.client_date ?? ""}`.trim() : r.approvals.firm ? `Approved ${day(r.approvals.firm.created_at)}` : i === 0 ? "Awaiting approval" : "Superseded";
    table.push({ boqId: r.boq_id, rev: n - i, date: day(r.created_at), cause: cause.length > 90 ? `${cause.slice(0, 89)}…` : cause, lines, delta, total: r.grand_total_aed, status, awaiting: i === 0 && !r.approvals.client });
  }
  const chrono = [...table].reverse();
  const reconciliation =
    chrono.length > 1 && chrono.slice(1).every((r) => r.delta != null)
      ? `${chrono.map((r, i) => (i === 0 ? r.total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : `${r.delta! < 0 ? "−" : "+"} ${Math.abs(r.delta!).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)).join(" ")} = ${chrono.at(-1)!.total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · Δ is the change to the project total; unpriced lines never enter it.`
      : null;

  // Documents: what each gate answers today. A document leaves only through the
  // export pack (T5), so its action is the pack; the proposal is the firm's (L4).
  const st = rail.statuses;
  const proposal = st.proposal;
  const drawings = process.env.DRAWINGS_ENABLED === "true";
  const pack = packExportEnabled();
  const documents: HubView["documents"] = [];
  if (estimate) {
    documents.push(
      { key: "drawings", label: "Drawing set", icon: "draft", state: drawings ? `Generated from the plan · rev ${n}` : "Not enabled on this deployment", locked: !drawings, action: drawings ? { label: "Open", href: `/project/${projectId}/drawings` } : null },
      pack
        ? { key: "boq_pdf", label: "BoQ PDF", icon: "table", state: `Through the export pack · rev ${n}`, locked: false, action: { label: "Export", href: `/project/${projectId}/drawings?export=1` } }
        : { key: "boq_pdf", label: "BoQ PDF", icon: "table", state: "The export pack is not enabled on this deployment", locked: true, action: null },
    );
    if (rail.persona === "firm") {
      documents.push({
        key: "proposal",
        label: "Client proposal",
        icon: "description",
        state: proposal?.state === "blocked" ? `Locked · ${proposal.reason ?? "the proposal gate refuses"}` : proposal?.state === "done" ? "Exported" : "Unlocked",
        locked: proposal?.state === "blocked",
        action: { label: proposal?.state === "blocked" ? "Why locked?" : "Set up", href: `/project/${projectId}/proposal` },
      });
    }
  }

  return {
    projectId,
    name: project?.display_name ?? project?.name ?? "Project",
    meta,
    estimate,
    next: nextFromRail(projectId, rail, journeyFlagsFromEnv()),
    revisions: table,
    reconciliation,
    documents,
  };
}


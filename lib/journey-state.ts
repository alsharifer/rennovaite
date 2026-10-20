// =============================================================================
// lib/journey-state.ts — every rail step's state, computed (K2, R7 §2 8:132).
//
// Pure: facts in, states out. The facts are the OUTPUTS of the gates the app
// already runs (lib/journey-facts.ts loads them) — regenerateReadiness's plan
// block, the proposal gate's verdict and reference basis, the approval trail,
// the recorded causes since the latest revision, the pack-export jobs — so a
// step's reason is never a second copy of a rule. Nothing here is stored.
//
//   done        the step's work exists for the current revision
//   available   nothing stops it and nothing is waiting on it
//   attention   it needs a look (book not reviewed, upstream change since the
//               revision, an approval outstanding) — with the reason
//   blocked     a gate refuses it — with the reason and where to fix it
//
// "Active" is not a state here: it is where the reader IS (the pathname), laid
// over whichever state the step has, so an active step keeps its reason.
// =============================================================================

import type { UpstreamChanges } from "@/lib/boq/changes-since";
import type { FirmStepKey, JourneyPersona, OwnerStepKey } from "@/lib/journey";

export type StepState = "done" | "available" | "attention" | "blocked";

export interface StepStatus {
  state: StepState;
  reason?: string;
  fix?: { label: string; href: string };
}

/** regenerateReadiness's plan refusal (lib/boq/regenerate.ts), authority codes excluded. */
export interface PlanBlock {
  code: "no_plan" | "no_area" | "no_rooms" | "plan_has_overlaps" | "rooms_unnamed" | "not_priceable";
  reason: string;
  fix?: { label: string; href: string };
}

export interface JourneyFacts {
  projectId: string;
  /** null = the plan prices (loadPriceablePlan found nothing to refuse). */
  planBlock: PlanBlock | null;
  /** The latest BoQ revision: its 1-based number and when it was generated. */
  boq: { rev: number; createdAt: string } | null;
  /** Accessory / specification selections recorded on the project. */
  specSelections: number;
  /**
   * Owner-journey evidence. `unpricedLines` = the latest BoQ's lines still to be
   * priced (isUnpricedLine, lib/documents/boq-derived.ts — the D4 rule).
   */
  /** K10: renderViews = renderable rooms / zones and how many of them have a locked design (lib/render-lock-progress.ts). */
  owner: { brief: boolean; moodboardItems: number; renders: number; renderViews: { locked: number; total: number }; unpricedLines: number; /** C2: the last export passed on the latest revision (exportedOn — by BoQ id). */ exported?: boolean };
  /** Firm-journey evidence — null for an owner project. */
  firm: {
    bookStatus: "draft" | "reviewed" | null;
    /** referenceBasisOf(latest BoQ) — lines below tier 1, and all lines. */
    basis: { referenceLines: number; totalLines: number } | null;
    /** proposalGateVerdict for the latest revision (loadProposalGate). */
    gate: { ok: boolean; reason: string | null; refusal: string | null };
    /** changesSinceRevision (lib/boq/changes-since.ts) — the SAME answer K3's Regenerate reads. */
    upstream: UpstreamChanges;
    /** approvalStatus(latest revision). */
    approval: { firm: boolean; client: boolean } | null;
    /** C2: the last export (any / with the proposal) PASSED on the latest revision — exportedOn, matched by BoQ id. */
    exported: { pack: boolean; proposal: boolean };
  } | null;
}

/** The plan refusal as a blocked downstream step: same words, the fix in 02 Scope. */
function blockedByPlan(b: PlanBlock): StepStatus {
  return { state: "blocked", reason: b.reason, ...(b.fix ? { fix: b.fix } : {}) };
}

export function firmStepStatuses(f: JourneyFacts): Record<FirmStepKey, StepStatus> {
  const id = f.projectId;
  const firm = f.firm;
  const plan = f.planBlock;
  const hasPlan = !plan || plan.code !== "no_plan";
  const noBoq: StepStatus = { state: "blocked", reason: "Generate the BoQ first", fix: { label: "Open BoQ", href: `/project/${id}/boq` } };

  const rates: StepStatus = (() => {
    if (!firm) return { state: "blocked", reason: "No firm book on this project" };
    if (firm.gate.ok) return { state: "done" };
    if (firm.basis && firm.basis.referenceLines > 0) {
      return { state: "attention", reason: `${firm.basis.referenceLines} of ${firm.basis.totalLines} lines on market reference`, fix: { label: "Review rates", href: `/project/${id}/rates` } };
    }
    if (firm.bookStatus !== "reviewed") return { state: "attention", reason: "Book not reviewed", fix: { label: "Review rates", href: `/project/${id}/rates` } };
    return { state: "done" };
  })();

  const boqReview: StepStatus = (() => {
    if (plan && plan.code !== "no_plan") return blockedByPlan(plan);
    if (!f.boq) return plan ? blockedByPlan(plan) : { state: "available" };
    const up = firm?.upstream.changed ? firm.upstream.summary : null;
    return up ? { state: "attention", reason: up, fix: { label: "Regenerate", href: `/project/${id}/boq` } } : { state: "done" };
  })();

  const documents: StepStatus = (() => {
    if (plan) return blockedByPlan(plan);
    if (!f.boq) return noBoq;
    return firm?.exported.pack ? { state: "done" } : { state: "available" };
  })();

  const revisions: StepStatus = (() => {
    if (!f.boq) return { state: "available" };
    const a = firm?.approval;
    if (a?.client) return { state: "done" };
    return {
      state: "attention",
      reason: `rev ${f.boq.rev} awaiting ${a?.firm ? "client" : "firm"} approval`,
      fix: { label: "Record approval", href: `/project/${id}/boq/revisions` },
    };
  })();

  const proposal: StepStatus = (() => {
    if (plan) return blockedByPlan(plan);
    if (!f.boq) return noBoq;
    if (!firm) return { state: "blocked", reason: "No firm on this project" };
    if (!firm.gate.ok) {
      // The proposal gate's own refusal, in the rail's few words (spec 9:361).
      const reason = firm.basis && firm.basis.referenceLines > 0 ? "Review rates or accept market basis" : (firm.gate.refusal ?? "The proposal gate refuses this revision");
      return { state: "blocked", reason, fix: { label: "Review rates", href: `/project/${id}/rates` } };
    }
    return firm.exported.proposal ? { state: "done" } : { state: "available" };
  })();

  return {
    hub: { state: "available" },
    project_plan: hasPlan ? { state: "done" } : { state: "attention", reason: "No plan yet", ...(plan?.fix ? { fix: plan.fix } : {}) },
    scope: !plan ? { state: "done" } : plan.code === "no_plan" ? { state: "available" } : { state: "attention", reason: plan.reason, ...(plan.fix ? { fix: plan.fix } : {}) },
    specification: f.specSelections > 0 ? { state: "done" } : { state: "available" },
    rates_basis: rates,
    boq_review: boqReview,
    documents,
    revisions,
    proposal,
  };
}

/** A design board needs this many pinned references before renders follow it (spec §6.0). */
export const DESIGN_MIN_REFERENCES = 3;

/**
 * The owner journey (spec §6.0). Only existing facts: the plan refusal, the
 * pinned references, the renders, and the latest BoQ's D4 unpriced lines.
 *   02 Design  attention "Add references" while fewer than 3 are pinned
 *   03 Renders done only when every renderable view is locked; else available "N / M locked" (K10)
 *   04 Cost    attention "N items not priced" while unpriced lines exist
 *   06 Tender  blocked "Price N items first" while unpriced lines exist, or
 *              blocked by the plan check (its own words and fix)
 */
export function ownerStepStatuses(f: JourneyFacts): Record<OwnerStepKey, StepStatus> {
  const id = f.projectId;
  const plan = f.planBlock;
  const planFails = plan && plan.code !== "no_plan" ? plan : null;
  const n = f.owner.unpricedLines;
  const items = `${n} item${n === 1 ? "" : "s"}`;
  return {
    overview: { state: "available" },
    plan: !plan ? { state: "done" } : plan.code === "no_plan" ? { state: "available" } : { state: "attention", reason: plan.reason, ...(plan.fix ? { fix: plan.fix } : {}) },
    design:
      f.owner.moodboardItems < DESIGN_MIN_REFERENCES
        ? { state: "attention", reason: "Add references", fix: { label: "Pin references", href: `/project/${id}/design?view=references` } }
        : { state: "done" },
    // K10: Done only when every renderable view is locked; otherwise Available with "N / M locked".
    renders:
      f.owner.renderViews.total > 0 && f.owner.renderViews.locked >= f.owner.renderViews.total
        ? { state: "done" }
        : f.owner.renderViews.total > 0
          ? { state: "available", reason: `${f.owner.renderViews.locked} / ${f.owner.renderViews.total} locked`, fix: { label: "Open renders", href: `/project/${id}/render` } }
          : { state: "available" },
    cost: planFails
      ? blockedByPlan(planFails)
      : n > 0
        ? { state: "attention", reason: `${items} not priced`, fix: { label: "See what is not priced", href: `/project/${id}/boq` } }
        : f.boq
          ? { state: "done" }
          : { state: "available" },
    timeline: { state: "available" },
    tender:
      n > 0
        ? { state: "blocked", reason: `Price ${items} first`, fix: { label: "Open cost", href: `/project/${id}/boq` } }
        : planFails
          ? blockedByPlan(planFails)
          : f.owner.exported
            ? { state: "done" }
            : { state: "available" },
  };
}

// --- What the rail renders (built by lib/journey-facts.ts; client-safe) -------------

export interface RailFirm {
  id: string;
  name: string;
  /** K10 (055): the caller is this firm's admin (the role that may delete its projects). */
  admin?: boolean;
}

export interface RailProject {
  id: string;
  name: string;
  /** The latest BoQ revision number (1-based) and its date — null before the first BoQ. */
  rev: number | null;
  revAt: string | null;
}

/** Everything the rail, top bar and phone drawer render — plain data, client-safe. */
export interface RailContext {
  persona: JourneyPersona;
  caller: { email: string | null };
  firms: RailFirm[];
  /** The firm in view: the project's (when the caller is a member) or, off-project, the caller's first. */
  firm: RailFirm | null;
  projects: RailProject[];
  project: RailProject | null;
  /** Step key → status (firm keys or owner keys, by persona). */
  statuses: Record<string, StepStatus>;
}

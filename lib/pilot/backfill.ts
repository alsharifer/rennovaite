// =============================================================================
// lib/pilot/backfill.ts — what 048 can recover from pre-048 rows, and what it
// cannot (L5). Pure planner; the script applies the patches and prints both.
//
// CAN, per row:
//   stage        detail.stage → the column (every old row that carried one);
//   firm_id +    a `correction` event → the firm and session of the correction
//   session_ref  it names (boq_corrections.firm_id / session_ref, 040–041);
//                a `session_decision` event → the firm whose corrections carry
//                the same record ("three-firms #1 — …") on that project, when
//                exactly one firm does; any event on a project that HAS a firm
//                (projects.firm_id) → that firm.
//
// CANNOT — and says so rather than guessing:
//   actor        no route knew the caller before 043 (U1, 26 Sep), and the old
//                writer never stored one: every pre-048 row stays actor = null,
//                so the firm's own time on those rows cannot be separated from a
//                script's or ours;
//   duration     never measured before 048;
//   reviews      boq_viewed / support_touch / rate_book_change did not exist;
//                Newspace's review of the Arabella BoQ (Sept 2026) left corrections
//                and decisions, but no "opened / closed" — checking time for that
//                pilot is bounded by the correction timestamps, not measured;
//   firm on a    an event with no correction, no decision and no project firm is
//   project      ours (scripted stages) or unattributable; it is NOT assigned. The
//                Arabella project itself has no firm_id: setting one is a pricing
//                and identity decision, not a backfill's.
// =============================================================================

export interface OldEventRow {
  id: string;
  project_id: string | null;
  kind: string;
  detail: Record<string, unknown> | null;
  firm_id: string | null;
  session_ref: string | null;
  stage: string | null;
  actor: string | null;
}

export interface CorrectionRef {
  id: string;
  project_id: string;
  firm_id: string | null;
  session_ref: string | null;
}

export interface BackfillPatch {
  id: string;
  patch: { stage?: string; firm_id?: string; session_ref?: string };
  reason: string;
}

export interface BackfillPlan {
  patches: BackfillPatch[];
  counts: { stage: number; firm_from_correction: number; firm_from_session: number; firm_from_project: number; untouched: number };
  cannot: string[];
}

export function planBackfill(events: readonly OldEventRow[], corrections: readonly CorrectionRef[], projectFirm: Readonly<Record<string, string | null>>): BackfillPlan {
  const byCorrection = new Map(corrections.map((c) => [c.id, c]));
  const counts = { stage: 0, firm_from_correction: 0, firm_from_session: 0, firm_from_project: 0, untouched: 0 };
  const patches: BackfillPatch[] = [];
  let noActor = 0;
  for (const e of events) {
    const patch: BackfillPatch["patch"] = {};
    const reasons: string[] = [];
    const stage = typeof e.detail?.stage === "string" ? e.detail.stage : null;
    if (!e.stage && stage) {
      patch.stage = stage;
      counts.stage++;
      reasons.push("stage from detail");
    }
    if (!e.firm_id) {
      const projectFirmId = e.project_id ? projectFirm[e.project_id] ?? null : null;
      const c = e.kind === "correction" && typeof e.detail?.correction_id === "string" ? byCorrection.get(e.detail.correction_id) : undefined;
      if (c?.firm_id) {
        patch.firm_id = c.firm_id;
        if (c.session_ref && !e.session_ref) patch.session_ref = c.session_ref;
        counts.firm_from_correction++;
        reasons.push("firm + session from the correction it names");
      } else if (e.kind === "session_decision" && e.project_id && typeof e.detail?.record === "string") {
        const record = e.detail.record;
        const firms = new Set(corrections.filter((x) => x.project_id === e.project_id && x.firm_id && x.session_ref === record).map((x) => x.firm_id!));
        if (firms.size === 1) {
          patch.firm_id = [...firms][0]!;
          if (!e.session_ref) patch.session_ref = record;
          counts.firm_from_session++;
          reasons.push("firm from the session's corrections");
        }
      } else if (projectFirmId) {
        patch.firm_id = projectFirmId;
        counts.firm_from_project++;
        reasons.push("firm from projects.firm_id");
      }
    }
    if (!e.actor) noActor++;
    if (Object.keys(patch).length) patches.push({ id: e.id, patch, reason: reasons.join("; ") });
    else counts.untouched++;
  }
  const cannot = [
    `actor: ${noActor} of ${events.length} rows have no actor and none can be recovered — no route knew the caller before 043 and the old writer stored none; the firm's own time on those rows is not separable from a script's or ours`,
    "duration_ms: never measured before 048; left null",
    "reviews / support: boq_viewed, support_touch and rate_book_change did not exist before 048 — the Arabella review's checking time is bounded by its correction timestamps, not measured",
    "firm on scripted or unattributable events: not assigned (an event with no correction, no decision record and no project firm is ours or unknown)",
    "projects.firm_id: not set by the backfill (Arabella's firm is a pricing + identity decision, not a data repair)",
  ];
  return { patches, counts, cannot };
}

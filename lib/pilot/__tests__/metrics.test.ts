import { describe, expect, it } from "vitest";

import { planBackfill, type CorrectionRef, type OldEventRow } from "../backfill";
import { firmOfProject, firmRollup, projectMetrics, sectionOfItem, threeFirmsEvidence, type CorrectionRow, type EventRow, type PackRow, type ProjectRow } from "../metrics";

// L5 — per-firm commercial instrumentation: the rollup and the backfill planner.

const T = (hhmm: string, day = "15") => `2026-09-${day}T${hhmm}:00.000Z`;
const ev = (over: Partial<EventRow> & { kind: string; recorded_at: string }): EventRow => ({ project_id: "p1", firm_id: "f1", actor: "u1", session_ref: null, duration_ms: null, stage: null, detail: null, ...over });
const P1: ProjectRow = { id: "p1", name: "Garden one", firm_id: "f1", created_at: T("08:00"), scope: "garden" };
const P2: ProjectRow = { id: "p2", name: "Villa two", firm_id: null, created_at: T("08:00"), scope: "interior" };
const corr = (over: Partial<CorrectionRow>): CorrectionRow => ({ project_id: "p1", firm_id: "f1", correction_type: "rate", item_key: "garden.pcc_base", section: "Hardscape & Structures", promoted_at: null, recorded_at: T("11:00"), session_ref: null, ...over });

describe("projectMetrics", () => {
  const events: EventRow[] = [
    ev({ kind: "plan_started", recorded_at: T("09:00") }),
    ev({ kind: "design_edit", recorded_at: T("09:30") }),
    ev({ kind: "boq_generated", recorded_at: T("10:00"), detail: { full: false }, duration_ms: 1200 }),
    ev({ kind: "boq_generated", recorded_at: T("10:30"), detail: { full: true }, actor: null, stage: "verification" }), // ours — not the pilot
    ev({ kind: "boq_generated", recorded_at: T("10:40"), detail: { full: true } }),
    ev({ kind: "boq_viewed", recorded_at: T("10:45") }),
    ev({ kind: "boq_viewed", recorded_at: T("11:10"), actor: "u2" }),
    ev({ kind: "support_touch", recorded_at: T("11:20"), detail: { channel: "chat", resolved: false } }),
    ev({ kind: "support_touch", recorded_at: T("11:25"), detail: { channel: "intervention", resolved: true }, actor: null }),
    ev({ kind: "friction", recorded_at: T("11:30") }),
    ev({ kind: "approval_recorded", recorded_at: T("13:00") }),
    ev({ kind: "basis_accepted", recorded_at: T("13:05") }),
    ev({ kind: "pack_exported", recorded_at: T("13:10"), detail: { document: "boq_pdf" }, actor: null }),
  ];
  const packs: PackRow[] = [
    { project_id: "p1", source: "cli", status: "passed", stage: "verification", actor: null, created_at: T("12:00"), finished_at: T("12:05"), proposal: false },
    { project_id: "p1", source: "app", status: "blocked", stage: null, actor: "u1", created_at: T("12:30"), finished_at: T("12:31"), proposal: true },
    { project_id: "p1", source: "app", status: "passed", stage: null, actor: "u1", created_at: T("13:20"), finished_at: T("13:40"), proposal: true },
  ];
  const corrections = [corr({}), corr({ correction_type: "rate", promoted_at: T("12:00") }), corr({ correction_type: "scope", item_key: null, section: null })];
  const m = projectMetrics(P1, events, corrections, packs);

  it("time to first BoQ, first FULL BoQ (pilot stages only) and checking time to the first release", () => {
    expect(m.time_to_first_boq_min).toBe(60); // plan_started 09:00 → 10:00
    expect(m.time_to_first_full_boq_min).toBe(100); // the verification one at 10:30 does not count
    expect(m.first_release_at).toBe(T("13:10")); // the handed-over BoQ PDF precedes the passed app pack (13:40)
    expect(m.checking_min).toBe(190); // 10:00 → 13:10
    expect(m.boq_generations).toBe(2);
  });

  it("corrections by type and section, and where they landed", () => {
    expect(m.corrections).toEqual({ total: 3, by_type: { rate: 2, scope: 1 }, by_section: { "Hardscape & Structures": 2, unmapped: 1 }, landed: { book: 1, project: 2 } });
  });

  it("support, reviews, approvals, packs, actors and the gaps", () => {
    expect(m.support).toEqual({ touches: 2, by_channel: { chat: 1, intervention: 1 }, unresolved: 1 });
    expect(m.reviews).toEqual({ views: 2, distinct_actors: 2, first_view_at: T("10:45") });
    expect(m.approvals).toBe(1);
    expect(m.acceptances).toBe(1);
    expect(m.packs).toEqual({ app_passed: 1, app_blocked: 1, app_failed: 0 });
    expect(m.actors).toBe(2);
    expect(m.events_without_actor).toBe(2); // the intervention and the handed-over PDF (the verification row is not pilot)
    // The first release (the handed-over PDF at 13:10) has no actor: said, not hidden.
    expect(m.gaps).toEqual([expect.stringMatching(/first release carries no actor/), expect.stringMatching(/2 of 12 pilot events carry no actor/)]);
  });

  it("a project with no BoQ says so, and one with no release keeps checking time open", () => {
    const none = projectMetrics(P2, [ev({ project_id: "p2", kind: "design_edit", recorded_at: T("09:00"), firm_id: null })], [], []);
    expect(none.time_to_first_boq_min).toBeNull();
    expect(none.gaps).toEqual(expect.arrayContaining(["no BoQ generated in a pilot stage", "no signed-in BoQ views recorded (boq_viewed exists since 048)", "project has no firm — attributed to a firm only through its corrections' firm_id"]));
    const open = projectMetrics(P2, [ev({ project_id: "p2", kind: "boq_generated", recorded_at: T("09:00"), firm_id: null })], [], []);
    expect(open.checking_min).toBeNull();
    expect(open.gaps).toContain("no release yet (no passed app export, no document handed over) — checking time open");
  });
});

describe("firmRollup / threeFirmsEvidence", () => {
  const events: EventRow[] = [
    ev({ kind: "boq_generated", recorded_at: T("10:00") }),
    ev({ project_id: "p2", firm_id: null, kind: "boq_generated", recorded_at: T("10:00"), actor: null }),
    ev({ project_id: null, kind: "rate_book_change", recorded_at: T("10:10"), detail: { action: "promote" } }),
    ev({ project_id: null, kind: "rate_book_change", recorded_at: T("10:11"), detail: { action: "entry" } }),
    ev({ project_id: "p3", firm_id: null, kind: "design_edit", recorded_at: T("10:00"), actor: null }),
  ];
  const corrections = [corr({}), corr({ project_id: "p2", firm_id: "f1" })];
  const P3: ProjectRow = { id: "p3", name: "Nobody's", firm_id: null, created_at: T("08:00"), scope: "interior" };

  it("attributes a project through projects.firm_id OR the single firm its corrections name, and says which", () => {
    expect(firmOfProject(P1, corrections)).toBe("f1");
    expect(firmOfProject(P2, corrections)).toBe("f1");
    expect(firmOfProject(P3, corrections)).toBeNull();
    const r = firmRollup({ id: "f1", name: "Firm one" }, [P1, P2, P3], events, corrections, []);
    expect(r.projects.map((p) => p.project_id)).toEqual(["p1", "p2"]);
    expect(r.totals.projects).toBe(2);
    expect(r.rate_book).toEqual({ entries: 1, promotions: 1, retirements: 0, quote_accepts: 0 });
    expect(r.gaps).toContain("1 project(s) attributed only through corrections (projects.firm_id is null)");
  });

  it("projects with events and no firm are listed, never dropped", () => {
    const e = threeFirmsEvidence([{ id: "f1", name: "Firm one" }], [P1, P2, P3], events, corrections, []);
    expect(e.firms[0]!.name).toBe("Firm one");
    expect(e.unattributed.map((p) => p.project_id)).toEqual(["p3"]);
  });

  it("sectionOfItem reads the garden vocabulary first, then the interior rules", () => {
    expect(sectionOfItem("garden.pcc_base", { "garden.pcc_base": "Hardscape & Structures" }, {})).toBe("Hardscape & Structures");
    expect(sectionOfItem("demo.soft_strip", {}, { "demo.soft_strip": "Demolition" })).toBe("Demolition");
    expect(sectionOfItem("nope", {}, {})).toBeNull();
    expect(sectionOfItem(null, {}, {})).toBeNull();
  });
});

describe("planBackfill", () => {
  const rows: OldEventRow[] = [
    { id: "e1", project_id: "p1", kind: "design_edit", detail: { stage: "session_apply" }, firm_id: null, session_ref: null, stage: null, actor: null },
    { id: "e2", project_id: "p1", kind: "correction", detail: { correction_id: "c1", correction_type: "scope" }, firm_id: null, session_ref: null, stage: null, actor: null },
    { id: "e3", project_id: "p1", kind: "session_decision", detail: { record: "three-firms #1", stage: "design_session" }, firm_id: null, session_ref: null, stage: null, actor: null },
    { id: "e4", project_id: "p1", kind: "boq_generated", detail: { full: true }, firm_id: null, session_ref: null, stage: null, actor: null },
    { id: "e5", project_id: "p9", kind: "design_edit", detail: {}, firm_id: null, session_ref: null, stage: null, actor: null },
    { id: "e6", project_id: "p1", kind: "friction", detail: { stage: "verification" }, firm_id: "f1", session_ref: null, stage: "verification", actor: "u1" },
  ];
  const corrections: CorrectionRef[] = [{ id: "c1", project_id: "p1", firm_id: "f1", session_ref: "three-firms #1" }];

  it("recovers stage from detail, firm + session from a correction or a session record, firm from the project — and nothing else", () => {
    const plan = planBackfill(rows, corrections, { p1: null, p9: "f9" });
    const by = Object.fromEntries(plan.patches.map((p) => [p.id, p.patch]));
    expect(by.e1).toEqual({ stage: "session_apply" }); // scripted stage; no firm (p1 has none, e1 names nothing)
    expect(by.e2).toEqual({ firm_id: "f1", session_ref: "three-firms #1" });
    expect(by.e3).toEqual({ stage: "design_session", firm_id: "f1", session_ref: "three-firms #1" });
    expect(by.e4).toBeUndefined(); // nothing to recover: no stage, no firm, no record
    expect(by.e5).toEqual({ firm_id: "f9" });
    expect(by.e6).toBeUndefined(); // already complete
    expect(plan.counts).toEqual({ stage: 2, firm_from_correction: 1, firm_from_session: 1, firm_from_project: 1, untouched: 2 });
  });

  it("states what cannot be backfilled, with the actor count", () => {
    const plan = planBackfill(rows, corrections, {});
    expect(plan.cannot[0]).toMatch(/^actor: 5 of 6 rows have no actor and none can be recovered/);
    expect(plan.cannot.join("\n")).toMatch(/duration_ms: never measured/);
    expect(plan.cannot.join("\n")).toMatch(/boq_viewed, support_touch and rate_book_change did not exist/);
    expect(plan.cannot.join("\n")).toMatch(/projects\.firm_id: not set/);
  });

  it("is idempotent: applying the patches leaves nothing to patch", () => {
    const plan = planBackfill(rows, corrections, { p9: "f9" });
    const applied = rows.map((r) => ({ ...r, ...(plan.patches.find((p) => p.id === r.id)?.patch ?? {}) }));
    expect(planBackfill(applied, corrections, { p9: "f9" }).patches).toEqual([]);
  });
});

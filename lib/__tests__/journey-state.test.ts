import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StepList, stepAccessibleName, type RailStep } from "@/components/blueprint/shell/StepList";
import { summarizeChanges } from "@/lib/boq/changes-since";
import { SIGNED_IN_HOME } from "@/lib/auth/link-error";
import { FIRM_STEPS, OWNER_STEPS, activeStepKey } from "@/lib/journey";
import { firmStepStatuses, ownerStepStatuses, type JourneyFacts, type PlanBlock } from "@/lib/journey-state";

// =============================================================================
// K2 — the rail's state matrix: each gate condition → the expected step state
// and reason. The facts are what the gates already return (regenerateReadiness,
// loadProposalGate, approvalStatus, loadRecordedCauses, latestPackJobs).
// =============================================================================

const P = "p1";
const OVERLAPS: PlanBlock = { code: "plan_has_overlaps", reason: "The plan has 4 overlapping rooms (Master Bed, Bath, …).", fix: { label: "Fix overlaps on the plan", href: `/project/${P}/plan` } };
const NO_PLAN: PlanBlock = { code: "no_plan", reason: "This project has no plan yet.", fix: { label: "Add a plan", href: `/project/${P}/plan` } };

/** A healthy firm project at rev 4: book reviewed, nothing upstream, firm-approved, exported. */
function facts(over: Partial<JourneyFacts> = {}, firm: Partial<NonNullable<JourneyFacts["firm"]>> = {}): JourneyFacts {
  return {
    projectId: P,
    planBlock: null,
    boq: { rev: 4, createdAt: "2026-10-01T10:00:00Z" },
    specSelections: 2,
    owner: { brief: true, moodboardItems: 3, renders: 5, renderViews: { locked: 4, total: 4 }, unpricedLines: 0 },
    firm: {
      bookStatus: "reviewed",
      basis: { referenceLines: 0, totalLines: 18 },
      gate: { ok: true, reason: "firm_basis", refusal: null },
      upstream: summarizeChanges([], 4),
      approval: { firm: true, client: true },
      exported: { pack: true, proposal: true },
      ...firm,
    },
    ...over,
  };
}
const states = (f: JourneyFacts) => Object.fromEntries(Object.entries(firmStepStatuses(f)).map(([k, v]) => [k, v.state]));

describe("firm journey — the state matrix", () => {
  it("a project with everything in place is done throughout (the hub is a place, not a task)", () => {
    expect(states(facts())).toEqual({ hub: "available", project_plan: "done", scope: "done", specification: "done", rates_basis: "done", boq_review: "done", documents: "done", revisions: "done", proposal: "done" });
  });

  it("book not reviewed, lines on market reference → 04 attention, 08 blocked (the proposal gate's refusal)", () => {
    const s = firmStepStatuses(facts({}, { bookStatus: "draft", basis: { referenceLines: 15, totalLines: 18 }, gate: { ok: false, reason: null, refusal: "15 of 18 lines are priced from the market reference…" }, exported: { pack: false, proposal: false } }));
    expect(s.rates_basis).toEqual({ state: "attention", reason: "15 of 18 lines on market reference", fix: { label: "Review rates", href: `/project/${P}/rates` } });
    expect(s.proposal).toMatchObject({ state: "blocked", reason: "Review rates or accept market basis" });
  });

  it("the firm accepted the market basis for this revision → 04 done, 08 available until a proposal is exported", () => {
    const s = firmStepStatuses(facts({}, { bookStatus: "draft", basis: { referenceLines: 15, totalLines: 18 }, gate: { ok: true, reason: "accepted", refusal: null }, exported: { pack: true, proposal: false } }));
    expect(s.rates_basis.state).toBe("done");
    expect(s.proposal.state).toBe("available");
  });

  it("a book not reviewed but no reference lines yet (no BoQ) → 04 attention 'Book not reviewed'", () => {
    const s = firmStepStatuses(facts({ boq: null }, { bookStatus: "draft", basis: null, gate: { ok: false, reason: null, refusal: "No BoQ has been generated yet." } }));
    expect(s.rates_basis).toMatchObject({ state: "attention", reason: "Book not reviewed" });
  });

  it("overlapping rooms (plan check) → 02 attention, 05 / 06 / 08 blocked with the SAME words and the fix in Scope", () => {
    const s = firmStepStatuses(facts({ planBlock: OVERLAPS }));
    expect(s.project_plan.state).toBe("done");
    expect(s.scope).toEqual({ state: "attention", reason: OVERLAPS.reason, fix: OVERLAPS.fix });
    for (const k of ["boq_review", "documents", "proposal"] as const) expect(s[k], k).toEqual({ state: "blocked", reason: OVERLAPS.reason, fix: OVERLAPS.fix });
  });

  it("no plan → 01 attention, 02 available, everything priced blocked on the plan", () => {
    const s = firmStepStatuses(facts({ planBlock: NO_PLAN, boq: null }));
    expect(s.project_plan).toMatchObject({ state: "attention", reason: "No plan yet" });
    expect(s.scope.state).toBe("available");
    expect(s.boq_review).toMatchObject({ state: "blocked", reason: NO_PLAN.reason });
    expect(s.documents).toMatchObject({ state: "blocked", reason: NO_PLAN.reason });
  });

  it("no BoQ yet → 05 available, 06 and 08 blocked 'Generate the BoQ first', 07 available", () => {
    const s = firmStepStatuses(facts({ boq: null }, { gate: { ok: false, reason: null, refusal: "No BoQ has been generated yet." } }));
    expect(s.boq_review.state).toBe("available");
    expect(s.documents).toMatchObject({ state: "blocked", reason: "Generate the BoQ first" });
    expect(s.proposal).toMatchObject({ state: "blocked", reason: "Generate the BoQ first" });
    expect(s.revisions.state).toBe("available");
  });

  it("upstream change since the revision (recorded causes) → 05 attention, naming what moved", () => {
    const causes = (...kinds: string[]) => kinds.map((kind) => ({ kind }) as { kind: "plan_edit" });
    expect(firmStepStatuses(facts({}, { upstream: summarizeChanges(causes("plan_edit", "plan_edit", "firm_rate"), 4) })).boq_review).toMatchObject({ state: "attention", reason: "plan edited, 1 book entry changed since rev 4" });
    expect(firmStepStatuses(facts({}, { upstream: summarizeChanges(causes("firm_rate", "firm_rate", "firm_rate", "session_decision"), 4) })).boq_review.reason).toBe("3 book entries changed, 1 decision recorded since rev 4");
    // A recorded correction is never applied — it does not make the BoQ stale.
    expect(firmStepStatuses(facts({}, { upstream: summarizeChanges(causes("correction"), 4) })).boq_review.state).toBe("done");
  });

  it("approval outstanding → 07 attention: firm first, then the client", () => {
    expect(firmStepStatuses(facts({}, { approval: { firm: false, client: false } })).revisions).toMatchObject({ state: "attention", reason: "rev 4 awaiting firm approval" });
    expect(firmStepStatuses(facts({}, { approval: { firm: true, client: false } })).revisions).toMatchObject({ state: "attention", reason: "rev 4 awaiting client approval" });
    expect(firmStepStatuses(facts({}, { approval: null })).revisions.state).toBe("attention");
  });

  it("documents: a passed export after the revision → done; none → available", () => {
    expect(firmStepStatuses(facts({}, { exported: { pack: false, proposal: false } })).documents.state).toBe("available");
  });

  it("specification is optional: no selections → available, never attention", () => {
    expect(firmStepStatuses(facts({ specSelections: 0 })).specification.state).toBe("available");
  });

  it("covers every firm step, 00–08, in order", () => {
    expect(FIRM_STEPS.map((s) => `${s.number} ${s.label}`)).toEqual([
      "00 Project hub",
      "01 Project & Plan",
      "02 Scope",
      "03 Specification",
      "04 Rates & Basis",
      "05 BoQ & Review",
      "06 Documents",
      "07 Revisions & Approval",
      "08 Proposal",
    ]);
    expect(Object.keys(firmStepStatuses(facts())).sort()).toEqual(FIRM_STEPS.map((s) => s.key).sort());
  });
});

describe("owner journey (K8, spec §6.0)", () => {
  const owner = (o: Partial<JourneyFacts["owner"]> = {}, over: Partial<JourneyFacts> = {}) => facts({ firm: null, ...over, owner: { brief: true, moodboardItems: 3, renders: 5, renderViews: { locked: 4, total: 4 }, unpricedLines: 0, ...o } });

  it("one status per owner step, in the step list's keys", () => {
    expect(Object.keys(ownerStepStatuses(owner())).sort()).toEqual(OWNER_STEPS.map((s) => s.key).sort());
  });

  it("done where the owner's work exists; the plan check blocks cost and tender", () => {
    const s = ownerStepStatuses(owner());
    expect(s.plan.state).toBe("done");
    expect(s.design.state).toBe("done");
    expect(s.renders.state).toBe("done");
    expect(s.cost.state).toBe("done");
    expect(s.tender.state).toBe("available");
    const blocked = ownerStepStatuses(owner({}, { planBlock: OVERLAPS }));
    expect(blocked.cost).toMatchObject({ state: "blocked", reason: OVERLAPS.reason });
    expect(blocked.tender).toMatchObject({ state: "blocked", reason: OVERLAPS.reason });
    expect(blocked.plan).toMatchObject({ state: "attention", reason: OVERLAPS.reason });
  });

  it("02 Design wants attention until 3 references are pinned", () => {
    for (const n of [0, 1, 2]) expect(ownerStepStatuses(owner({ moodboardItems: n })).design).toMatchObject({ state: "attention", reason: "Add references", fix: { href: `/project/${P}/design?view=references` } });
    expect(ownerStepStatuses(owner({ moodboardItems: 3 })).design.state).toBe("done");
  });

  it("unpriced lines: 04 Cost needs attention, 06 Tender is blocked until they are priced", () => {
    const s = ownerStepStatuses(owner({ unpricedLines: 2 }));
    expect(s.cost).toMatchObject({ state: "attention", reason: "2 items not priced" });
    expect(s.tender).toMatchObject({ state: "blocked", reason: "Price 2 items first" });
    expect(ownerStepStatuses(owner({ unpricedLines: 1 })).tender.reason).toBe("Price 1 item first");
  });
});

describe("which step a page lights", () => {
  it("firm: exact project-relative match (07 is not 05)", () => {
    expect(activeStepKey("firm", `/project/${P}`, P)).toBe("hub");
    expect(activeStepKey("firm", `/project/${P}/plan`, P)).toBe("scope");
    expect(activeStepKey("firm", `/project/${P}/rates`, P)).toBe("rates_basis");
    expect(activeStepKey("firm", `/project/${P}/boq`, P)).toBe("boq_review");
    expect(activeStepKey("firm", `/project/${P}/boq/revisions`, P)).toBe("revisions");
    expect(activeStepKey("firm", `/project/${P}/drawings`, P)).toBe("documents");
    expect(activeStepKey("firm", `/project/${P}/proposal`, P)).toBe("proposal");
    expect(activeStepKey("firm", `/project/${P}/viewer`, P)).toBeNull();
    expect(activeStepKey("firm", "/settings", null)).toBeNull();
  });

  it("owner: seven steps; two-route steps light on both routes; the intake is 01 Plan", () => {
    expect(activeStepKey("owner", "/project/new", null)).toBe("plan");
    expect(activeStepKey("owner", `/project/${P}`, P)).toBe("overview");
    expect(activeStepKey("owner", `/project/${P}/plan`, P)).toBe("plan");
    expect(activeStepKey("owner", `/project/${P}/design`, P)).toBe("design");
    expect(activeStepKey("owner", `/project/${P}/render`, P)).toBe("renders");
    expect(activeStepKey("owner", `/project/${P}/boq`, P)).toBe("cost");
    expect(activeStepKey("owner", `/project/${P}/accessories`, P)).toBe("cost");
    expect(activeStepKey("owner", `/project/${P}/timeline`, P)).toBe("timeline");
    expect(activeStepKey("owner", `/project/${P}/drawings`, P)).toBe("tender");
    expect(activeStepKey("owner", `/project/${P}/vendors`, P)).toBe("tender");
    expect(activeStepKey("owner", `/project/${P}/viewer`, P)).toBeNull();
  });
});

describe("the rail speaks its states (spec §2 Journey step, §4.2)", () => {
  const blocked: RailStep = { key: "proposal", number: "08", label: "Proposal", href: "/x", status: { state: "blocked", reason: "Review rates or accept market basis" } };
  it("a blocked step announces its reason in its accessible name", () => {
    expect(stepAccessibleName(blocked)).toBe("08 Proposal — blocked: review rates or accept market basis");
    expect(stepAccessibleName({ ...blocked, status: { state: "attention", reason: "15 of 18 lines on market reference" } })).toBe("08 Proposal — needs attention: 15 of 18 lines on market reference");
    expect(stepAccessibleName({ ...blocked, status: { state: "done" } })).toBe("08 Proposal — done");
    expect(stepAccessibleName({ ...blocked, status: { state: "available" } })).toBe("08 Proposal");
  });

  it("the active step is aria-current=step; blocked steps stay links", () => {
    const steps: RailStep[] = [
      { key: "boq_review", number: "05", label: "BoQ & Review", href: "/project/p1/boq", status: { state: "done" } },
      blocked,
    ];
    const html = renderToStaticMarkup(createElement(StepList, { steps, activeKey: "boq_review" }));
    const links = [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]);
    const boq = links.find((a) => a.includes('href="/project/p1/boq"'))!;
    const proposal = links.find((a) => a.includes('href="/x"'))!;
    expect(boq).toContain('aria-current="step"');
    expect(proposal).toContain('aria-label="08 Proposal — blocked: review rates or accept market basis"');
    expect(proposal).not.toContain("aria-current");
    expect(html.match(/aria-current="step"/g)?.length).toBe(1);
  });
});

describe("no duplicated rules: the facts come from the gates", () => {
  const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
  it("the loader runs the gates the app already runs", () => {
    const src = read("lib/journey-facts.ts");
    for (const fn of ["regenerateReadiness(", "loadProposalGate(", "approvalStatus(", "changesSinceRevision(", "latestPackJobs(", "listFirms("]) expect(src, fn).toContain(fn);
  });
  it("the state model is pure — no database, no environment", () => {
    const src = read("lib/journey-state.ts");
    expect(src).not.toMatch(/supabase|process\.env|fetch\(/);
  });
  it("the rail and its pieces are client-safe: they never import the server loader", () => {
    for (const f of ["components/blueprint/shell/JourneyRail.tsx", "components/blueprint/shell/TopBar.tsx", "components/blueprint/shell/StepList.tsx", "components/blueprint/shell/ShellFrame.tsx", "components/blueprint/shell/HelpDrawer.tsx"]) {
      const imports = read(f)
        .split("\n")
        .filter((l) => l.startsWith("import "))
        .join("\n");
      expect(imports, f).not.toMatch(/journey-facts|identity\/curation|provenance\/tier"|supabase/);
    }
  });
});

describe("chrome wiring + route triage (spec §3.10)", () => {
  const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
  const exists = (f: string) => {
    try {
      read(f);
      return true;
    } catch {
      return false;
    }
  };

  it("every redesigned segment frames itself in a layout and has its own loading / error / not-found inside the shell", () => {
    for (const seg of ["boq", "plan", "drawings", "rates", "proposal", "design", "render", "accessories", "timeline", "vendors", "viewer"]) {
      const dir = `app/project/[id]/${seg}`;
      expect(read(`${dir}/layout.tsx`), seg).toContain("<ProjectShell");
      expect(read(`${dir}/loading.tsx`), seg).toContain("SegmentLoading");
      expect(read(`${dir}/error.tsx`), seg).toContain("SegmentError");
      expect(exists(`${dir}/not-found.tsx`), seg).toBe(true);
    }
    expect(read("app/firms/[firmId]/layout.tsx")).toContain("<AccountShell");
    expect(read("app/settings/layout.tsx")).toContain("<AccountShell");
    expect(read("app/projects/layout.tsx")).toContain("<AccountShell");
    // The hub sits at the [id] level and frames itself; its loading draws the chrome.
    expect(read("app/project/[id]/page.tsx")).toContain(`<ProjectShell projectId={projectId}>`);
    // K6: the intake is Blueprint too (warm skin), framed without a project.
    expect(read("app/project/new/page.tsx")).toContain(`<AccountShell skin="warm">`);
    expect(read("app/project/[id]/loading.tsx")).toContain("ShellSkeleton");
  });

  it("Marketplace and Community are cut from navigation, have no page, and redirect (307) to the Projects home", () => {
    expect(read("components/blueprint/shell/JourneyRail.tsx")).not.toMatch(/\/(marketplace|community)/);
    expect(read("components/marketing/TopNav.tsx")).not.toContain('"/marketplace"');
    for (const r of ["marketplace", "community"]) {
      expect(existsSync(path.join(process.cwd(), "app", r, "page.tsx")), r).toBe(false);
      expect(read("next.config.ts")).toContain(`{ source: "/${r}", destination: "${SIGNED_IN_HOME}", permanent: false }`);
    }
  });

  it("/support opens the help drawer; /firms goes straight to a single firm's book", () => {
    expect(read("app/support/page.tsx")).toContain('redirect("/settings?help=1")');
    expect(read("components/blueprint/shell/HelpDrawer.tsx")).toContain('params.get("help") === "1"');
    expect(read("app/firms/page.tsx")).toMatch(/if \(firms\.length === 1\) redirect\(`\/firms\/\$\{firms\[0\]!\.id\}`\)/);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { IssuesNavigator } from "@/components/blueprint/shell/IssuesNavigator";
import fixture from "@/lib/boq/__fixtures__/arabella-g5d-revisions.json";
import { ownerStepStatuses, type JourneyFacts } from "@/lib/journey-state";

import { boqIssues, nextIssueKey, stepIssues } from "../issues";
import { buildReviewModel, type ReviewBoq } from "../review-model";
import { reroundRevision } from "../totals";

// K11 #3 (spec §7.1, Figma 80:49) — the Issues navigator's list, from the model
// and the rail's own StepStatus. Arabella rev 4 (H7): 3 lines to be priced, 9
// derived lines, no duplicates — "4 TO FIX" (3 + the derived group once).

const REV4 = reroundRevision((fixture as unknown as { boqs: Record<string, ReviewBoq> }).boqs["e042b9eb-6053-41f4-8207-471e85d883f4"]! as never) as ReviewBoq;
const build = (over: Partial<Parameters<typeof buildReviewModel>[0]> = {}) =>
  buildReviewModel({ projectId: "p1", boqId: "b", rev: 4, revDate: "22 Sep 2026", persona: "owner", boq: REV4, provenance: null, tierCtx: { qsValidated: {} }, firm: null, basis: null, duplicates: [], budget: null, ...over });

const facts = (unpricedLines: number): JourneyFacts => ({
  projectId: "p1",
  planBlock: null,
  boq: { rev: 4, createdAt: "2026-09-22T08:00:00Z" },
  specSelections: 0,
  owner: { brief: true, moodboardItems: 3, renders: 0, renderViews: { locked: 0, total: 0 }, unpricedLines },
  firm: null,
});

describe("boqIssues", () => {
  const model = build();
  const cost = ownerStepStatuses(facts(model.headline.excluded.length)).cost;

  it("the rail and the navigator count the same unpriced lines (the rail's reason is not repeated)", () => {
    expect(cost).toMatchObject({ state: "attention", reason: "3 items not priced" });
    const list = boqIssues(model, cost);
    expect(list.groups.map((g) => g.key)).toEqual(["unpriced", "derived"]);
    const unpriced = list.groups[0]!;
    expect(unpriced.title).toBe("NOT PRICED — LEFT OUT OF THE TOTAL");
    expect(unpriced.rows.map((r) => `${r.ref} ${r.action}`)).toEqual(["PLB-01 Add a price", "PLB-02 Add a price", "SFT-03 Add a price"]);
    expect(unpriced.rows.every((r) => r.open === "price" && !!r.lineKey)).toBe(true);
    expect(list.groups[1]).toMatchObject({ title: "DERIVED — CONFIRM ON SITE", count: 9 });
    expect(list.groups[1]!.rows).toHaveLength(1); // the derived group counts once
    expect(list.count).toBe(4); // "4 TO FIX", as 80:49
  });

  it("issue lines in BoQ order; J / Shift+J cycle and wrap", () => {
    const { lineKeys } = boqIssues(model, cost);
    expect(lineKeys).toHaveLength(12); // 3 unpriced + 9 derived
    const flat = model.sections.flatMap((s) => s.lines.map((l) => l.key));
    expect([...lineKeys].sort((a, b) => flat.indexOf(a) - flat.indexOf(b))).toEqual(lineKeys);
    expect(nextIssueKey(lineKeys, null)).toBe(lineKeys[0]);
    expect(nextIssueKey(lineKeys, lineKeys[0]!)).toBe(lineKeys[1]);
    expect(nextIssueKey(lineKeys, lineKeys.at(-1)!)).toBe(lineKeys[0]);
    expect(nextIssueKey(lineKeys, lineKeys[0]!, true)).toBe(lineKeys.at(-1));
    expect(nextIssueKey([], null)).toBeNull();
  });

  it("duplicates name their lines; owner words vs firm words", () => {
    const dup = { label: "Bathroom mirror", detail: "R-31 in Joinery is also priced as mirror in Plumbing", lineKeys: ["Plumbing-0", "Hardscape & Structures-0"] };
    const owner = boqIssues(build({ duplicates: [dup] }), null).groups.find((g) => g.key === "duplicates")!;
    expect(owner.rows[0]).toMatchObject({ title: "Bathroom mirror", detail: "We’ll confirm before tender", lineKey: "Plumbing-0", ref: "PLB-01" });
    const firm = boqIssues(build({ duplicates: [dup], persona: "firm" }), null).groups.find((g) => g.key === "duplicates")!;
    expect(firm.rows[0]!.detail).toMatch(/also priced as/);
  });

  it("the step's own reason joins when it is not the unpriced one (plan check, changed since rev N)", () => {
    const list = boqIssues(model, { state: "blocked", reason: "2 rooms on the plan overlap", fix: { label: "Fix overlaps", href: "/project/p1/plan" } });
    expect(list.groups.at(-1)).toMatchObject({ key: "step", title: "BLOCKED", rows: [{ title: "2 rooms on the plan overlap", action: "Fix overlaps", href: "/project/p1/plan", lineKey: null }] });
    expect(list.count).toBe(5);
  });

  it("K11: an applied price that no longer matches a line leads the list — Remove / Re-apply to…", () => {
    const m = build({ unmatched: [{ correction_id: "c1", label: "Soft Landscaping — Planting beds — soil preparation and planting (no reference rate — QS to price)", type: "rate", value: 85, basis_kind: "own_estimate", note: "Oct 2026", by: "abdallah" }] });
    const list = boqIssues(m, null);
    expect(list.groups[0]).toMatchObject({ key: "unmatched", title: "YOUR PRICES — NO LONGER MATCHED", count: 1 });
    expect(list.groups[0]!.rows[0]).toMatchObject({ title: "Your price for Planting beds — soil preparation and planting no longer matches a line", correctionId: "c1", lineKey: null, actions: [{ key: "release", label: "Remove" }, { key: "retarget", label: "Re-apply to…" }] });
    expect(list.groups[0]!.rows[0]!.detail).toBe("rate 85.00 · My own estimate — Oct 2026 · added by abdallah");
    expect(list.count).toBe(boqIssues(build(), null).count + 1);
  });

  it("nothing to fix → N = 0 and the button is not drawn", () => {
    const priced = REV4.sections.map((s) => ({ ...s, lines: s.lines.map((l) => ({ ...l, rate_status: "priced", qty_derived: false, rate_aed: l.rate_aed || 1, total_aed: l.total_aed || l.quantity })) }));
    const clean = build({ boq: { ...REV4, sections: priced } as ReviewBoq });
    const list = boqIssues(clean, { state: "done" });
    expect(list).toEqual({ groups: [], count: 0, lineKeys: [] });
    expect(renderToStaticMarkup(createElement(IssuesNavigator, { issues: list }))).toBe("");
  });

  it("the button reads ⚑ N TO FIX", () => {
    const out = renderToStaticMarkup(createElement(IssuesNavigator, { issues: boqIssues(model, cost) }));
    expect(out).toContain("4 TO FIX");
    expect(out).toContain('aria-haspopup="dialog"');
    expect(out).toContain('data-issue-count="4"');
  });
});

describe("stepIssues — any other step page", () => {
  it("the rail's attention / blocked reason, as one issue with its fix", () => {
    const s = ownerStepStatuses(facts(3));
    expect(stepIssues(s.tender, "Tender")).toMatchObject({ count: 1, groups: [{ title: "BLOCKED — TENDER", rows: [{ title: "Price 3 items first", action: "Open cost", href: "/project/p1/boq" }] }] });
    expect(stepIssues(s.timeline, "Timeline").count).toBe(0); // available, no reason
  });
});

describe("the wiring (static)", () => {
  const ROOT = path.resolve(__dirname, "../../..");
  const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

  it("the BoQ page passes the rail's own status for this step; the shell draws the generic one elsewhere", () => {
    expect(read("app/project/[id]/boq/page.tsx")).toMatch(/rail\.statuses\[rail\.persona === "firm" \? "boq_review" : "cost"\]/);
    expect(read("components/blueprint/shell/ShellFrame.tsx")).toMatch(/stepIssues\(activeStep\.status, activeStep\.label\)/);
    const review = read("components/blueprint/boq/BoqReview.tsx");
    expect(review).toMatch(/boqIssues\(model, stepStatus\)/);
    expect(review).toMatch(/e\.key !== "j" && e\.key !== "J"/);
  });
});

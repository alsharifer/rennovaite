import { describe, expect, it } from "vitest";

import type { StepStatus } from "@/lib/journey-state";

import { HOME_TABS, age, homeNext, homeStage, inTab, sortRows, tabCounts, type HomeRow } from "../home";

// K8 #1 — the Projects home's rules (spec §6.1): stage and Next come from the
// rail's step states, never from a rule of their own.

const done: StepStatus = { state: "done" };
const avail: StepStatus = { state: "available" };

describe("stage", () => {
  const owner = (statuses: Record<string, StepStatus>, hasBoq: boolean, status: string | null = "draft") => homeStage({ status, persona: "owner", statuses, hasBoq });

  it("the project's own status wins", () => {
    expect(owner({ plan: done }, true, "completed")).toBe("completed");
    expect(owner({ plan: done }, true, "on_hold")).toBe("on_hold");
    expect(owner({ plan: done }, true, "in_construction")).toBe("in_progress");
  });

  it("then how far the work has got: plan → design → costing", () => {
    expect(owner({ plan: { state: "attention", reason: "2 rooms overlap" } }, false)).toBe("plan");
    expect(owner({ plan: avail }, false)).toBe("plan");
    expect(owner({ plan: done }, false)).toBe("design");
    expect(owner({ plan: done }, true)).toBe("costing");
  });

  it("a firm project moves to approval, then documents, on its revision's approvals", () => {
    const firm = (revisions: StepStatus) => homeStage({ status: "draft", persona: "firm", statuses: { scope: done, revisions }, hasBoq: true });
    expect(firm({ state: "attention", reason: "rev 3 awaiting firm approval" })).toBe("costing");
    expect(firm({ state: "attention", reason: "rev 3 awaiting client approval" })).toBe("approval");
    expect(firm(done)).toBe("documents");
  });
});

describe("next", () => {
  it("is the first Attention / Blocked step, in journey order, with the rail's reason and fix", () => {
    const n = homeNext("p", "firm", { scope: done, rates_basis: { state: "attention", reason: "23 of 56 lines on market reference", fix: { label: "Review rates", href: "/project/p/rates" } }, proposal: { state: "blocked", reason: "Review rates or accept market basis" } }, (k) => `/x/${k}`);
    expect(n).toEqual({ state: "attention", step: "04 · RATES & BASIS", reason: "23 of 56 lines on market reference", href: "/project/p/rates" });
  });

  it("owner steps use the owner numbers; no fix → the step's own page", () => {
    expect(homeNext("p", "owner", { design: { state: "attention", reason: "Add references" }, tender: { state: "blocked", reason: "Price 2 items first" } }, (k) => `/step/${k}`)).toEqual({ state: "attention", step: "02 · DESIGN", reason: "Add references", href: "/step/design" });
  });

  it("nothing waiting → null", () => {
    expect(homeNext("p", "owner", { plan: done, design: done }, () => "")).toBeNull();
  });
});

describe("tabs, sort, ages", () => {
  const row = (id: string, stage: HomeRow["stage"], over: Partial<HomeRow> = {}): HomeRow => ({ id, name: id, scope: null, stage, rev: null, estimate: null, next: null, updatedAt: "2026-10-01T00:00:00Z", thumb: null, archived: false, ...over });
  const rows = [row("a", "plan"), row("b", "design"), row("c", "costing"), row("d", "approval"), row("e", "documents"), row("f", "in_progress"), row("g", "completed"), row("h", "on_hold")];

  it("counts per tab: Design takes Plan, Approval takes Documents, All takes everything", () => {
    expect(tabCounts(rows)).toEqual({ all: 8, design: 2, costing: 1, approval: 2, in_progress: 1, completed: 1 });
    expect(HOME_TABS.map((t) => t.label)).toEqual(["All", "Design", "Costing", "Approval", "In progress", "Completed"]);
    expect(inTab(row("x", "on_hold"), "all")).toBe(true);
    expect(inTab(row("x", "on_hold"), "design")).toBe(false);
  });

  it("sorts by update, name or estimate (no BoQ last)", () => {
    const r = [row("b", "plan", { updatedAt: "2026-10-02T00:00:00Z", estimate: { total: 5, estimate: true, excludes: 0, tier: "derived" } }), row("a", "plan", { updatedAt: "2026-10-03T00:00:00Z" }), row("c", "plan", { estimate: { total: 9, estimate: false, excludes: 0, tier: "market" } })];
    expect(sortRows(r, "updated").map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(sortRows(r, "name").map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(sortRows(r, "estimate").map((x) => x.id)).toEqual(["c", "b", "a"]);
  });

  it("prints the frames' compact ages", () => {
    const now = Date.parse("2026-10-13T12:00:00Z");
    expect(age("2026-10-13T10:00:00Z", now)).toBe("2 h");
    expect(age("2026-10-12T11:00:00Z", now)).toBe("1 d");
    expect(age("2026-09-29T12:00:00Z", now)).toBe("2 w");
  });
});

describe("dates", () => {
  it("prints the frames' revision date in Dubai time, three-letter month", async () => {
    const { shortDate } = await import("../home");
    expect(shortDate("2026-09-28T21:30:00Z")).toBe("29 Sep");
    expect(shortDate("2026-10-04T08:00:00Z")).toBe("4 Oct");
  });
});

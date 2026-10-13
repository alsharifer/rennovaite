import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StepFooter, continueLabel, footerSteps } from "@/components/blueprint/shell/StepFooter";
import { railSteps } from "@/components/blueprint/shell/ShellFrame";
import type { JourneyFacts, RailContext } from "@/lib/journey-state";
import { ownerStepStatuses, firmStepStatuses } from "@/lib/journey-state";

// K11 #2 (spec §7.2, component 80:944) — previous · next on every journey step
// page; Continue is disabled with the RAIL's reason when the next step is blocked.

const facts = (over: Partial<JourneyFacts["owner"]> = {}): JourneyFacts => ({
  projectId: "p1",
  planBlock: null,
  boq: { rev: 4, createdAt: "2026-10-13T08:00:00Z" },
  specSelections: 0,
  owner: { brief: true, moodboardItems: 3, renders: 3, renderViews: { locked: 3, total: 3 }, unpricedLines: 0, ...over },
  firm: null,
});
const flags = { drawingsEnabled: true };
const ctx = (statuses: Record<string, unknown>, persona: "owner" | "firm" = "owner"): RailContext =>
  ({ persona, caller: { email: null }, firms: [], firm: null, projects: [], project: { id: "p1", name: "Villa", rev: 4, revAt: null }, statuses }) as RailContext;
const html = (c: RailContext, active: string) => renderToStaticMarkup(createElement(StepFooter, { steps: railSteps(c, flags), activeKey: active }));

describe("the owner journey", () => {
  it("04 Cost → previous 03 Renders, next 05 Timeline with Continue to timeline (the walkthrough's dead end)", () => {
    const out = html(ctx(ownerStepStatuses(facts())), "cost");
    expect(out).toContain("PREVIOUS");
    expect(out).toContain("03 Renders");
    expect(out).toContain("05 Timeline");
    expect(out).toContain("Continue to timeline");
    expect(out).toMatch(/href="\/project\/p1\/timeline"[^>]*data-testid="step-footer-continue"|data-testid="step-footer-continue"[^>]*href="\/project\/p1\/timeline"/);
    expect(out).not.toContain('aria-disabled="true"');
  });

  it("the next step blocked → Continue disabled, described by the rail's own reason and fix", () => {
    const statuses = ownerStepStatuses(facts({ unpricedLines: 3 }));
    const out = html(ctx(statuses), "timeline");
    expect(statuses.tender).toMatchObject({ state: "blocked", reason: "Price 3 items first" });
    expect(out).toContain("Continue to tender");
    expect(out).toContain('aria-disabled="true"');
    expect(out).toContain('aria-describedby="bp-step-footer-next-why"');
    expect(out).toMatch(/id="bp-step-footer-next-why"[^>]*>Price 3 items first/);
    expect(out).toContain("Open cost");
  });

  it("first and last steps: no previous on 00, no next on the last", () => {
    const steps = railSteps(ctx(ownerStepStatuses(facts())), flags);
    expect(footerSteps(steps, "overview").previous).toBeNull();
    expect(footerSteps(steps, steps.at(-1)!.key).next).toBeNull();
    expect(footerSteps(steps, null)).toEqual({ previous: null, next: null });
  });
});

describe("the firm journey", () => {
  it("05 BoQ & Review → 06 Documents, in the firm's own order", () => {
    const f: JourneyFacts = {
      ...facts(),
      firm: { bookStatus: "reviewed", basis: null, gate: { ok: true, reason: null, refusal: null }, upstream: { changed: false } as never, approval: null, exported: { pack: false, proposal: false } },
    };
    const out = html(ctx(firmStepStatuses(f), "firm"), "boq_review");
    expect(out).toContain("04 Rates &amp; Basis");
    expect(out).toContain("06 Documents");
    expect(out).toContain("Continue to documents");
  });
});

it("the shell renders it on every project step page (not a side surface, not the intake)", () => {
  const src = readFileSync(path.resolve(__dirname, "../../components/blueprint/shell/ShellFrame.tsx"), "utf8");
  expect(src).toMatch(/\{projectId && stepKey \? <StepFooter steps=\{steps\} activeKey=\{stepKey\} \/> : null\}/);
  const step = (label: string) => ({ key: "x", number: "05", label, href: "/", status: { state: "available" as const } });
  expect(continueLabel(step("Timeline"))).toBe("Continue to timeline");
  expect(continueLabel(step("BoQ & Review"))).toBe("Continue to BoQ & review");
  expect(continueLabel(step("Project & Plan"))).toBe("Continue to project & plan");
  expect(continueLabel(step("Revisions & Approval"))).toBe("Continue to revisions & approval");
});

it("05 Timeline's own top-bar Continue gives the footer's answer (the rail's status for 06 Tender)", () => {
  const src = readFileSync(path.resolve(__dirname, "../../app/project/[id]/timeline/page.tsx"), "utf8");
  expect(src).toMatch(/const nextStatus = rail\?\.statuses\[next\.key\]/);
  expect(src).toMatch(/disabled=\{blocked \? \{ reason: blocked/);
});

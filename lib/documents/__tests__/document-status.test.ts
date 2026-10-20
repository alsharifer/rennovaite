// Sprint C2 #1 — one status rule: a badge = f(validation result, revision id),
// never flags, timestamps or existence. Closes the three C0 defects:
//   1. the Overview / firm hub said "Ready" from feature flags + "a BoQ exists";
//   2. 06 Documents showed PASS under whichever revision was current;
//   3. the 06 Documents step compared timestamps, so an in-app export (which
//      regenerates the BoQ inside its own job) could never show done.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT } from "@/lib/__tests__/helpers/import-graph";
import { firmStepStatuses, ownerStepStatuses, type JourneyFacts } from "@/lib/journey-state";

import { documentStatus, exportedOn, type JobFact } from "../document-status";

const job = (id: string, status: JobFact["status"], created_at: string, boqId: string | null, extra: Partial<JobFact> = {}): JobFact => ({
  id,
  status,
  created_at,
  manifest: boqId ? { boq: { id: boqId, grand_total_aed: 1 }, checks: status === "failed" ? [{ label: "drawing set exports as PDF", ok: false, detail: "500" }] : [{ label: "ok", ok: true, detail: "" }] } : null,
  checklist: null,
  error: null,
  options: {},
  ...extra,
});

const REV2 = { boqId: "boq-2", rev: 2 };

describe("Ready = the last export passed on the CURRENT revision, by BoQ id", () => {
  it("a drawing set whose export fails can never show Ready", () => {
    const s = documentStatus({ available: true, current: REV2, jobs: [job("j1", "failed", "2026-10-21T10:00:00Z", "boq-2")] });
    expect(s.state).toBe("needs_check");
    expect(s.label).toBe("Needs check: the last export failed — drawing set exports as PDF");
    // A run that threw before any check (Mudon's A-102) fails too, with its error.
    const threw = documentStatus({ available: true, current: REV2, jobs: [job("j2", "failed", "2026-10-21T10:00:00Z", null, { error: 'Sheet A-102 "Proposed / Demolition Plan" could not be drawn: the plan graph has no `elements`' })] });
    expect(threw.state).toBe("needs_check");
    expect(threw.reason).toContain("Sheet A-102");
  });

  it("an export of rev N shows PASS only on rev N", () => {
    const jobs = [job("j1", "passed", "2026-10-21T10:00:00Z", "boq-2")];
    expect(documentStatus({ available: true, current: REV2, jobs })).toMatchObject({ state: "ready", label: "Ready · rev 2" });
    expect(documentStatus({ available: true, current: { boqId: "boq-3", rev: 3 }, jobs })).toMatchObject({ state: "needs_check", label: "Needs check: the BoQ changed since the last export — export rev 3" });
  });

  it("the LAST export decides: a later failure after an earlier pass on the same revision is not Ready", () => {
    const jobs = [job("j1", "passed", "2026-10-21T10:00:00Z", "boq-2"), job("j2", "failed", "2026-10-21T11:00:00Z", "boq-2")];
    expect(documentStatus({ available: true, current: REV2, jobs }).state).toBe("needs_check");
  });

  it("blocked names its first open item; never exported says so; a running job says so", () => {
    const blocked = job("j1", "blocked", "2026-10-21T10:00:00Z", null, { checklist: [{ key: "name", ok: false, title: "A client-facing name", detail: "", items: [], fix: null }] });
    expect(documentStatus({ available: true, current: REV2, jobs: [blocked] }).label).toBe("Needs check: export blocked — A client-facing name");
    expect(documentStatus({ available: true, current: REV2, jobs: [] }).label).toBe("Needs check: not exported yet");
    expect(documentStatus({ available: true, current: REV2, jobs: [job("j1", "running", "2026-10-21T10:00:00Z", null)] }).label).toBe("Export running");
  });

  it("a flag decides availability, never readiness", () => {
    const jobs = [job("j1", "passed", "2026-10-21T10:00:00Z", "boq-2")];
    expect(documentStatus({ available: false, current: REV2, jobs })).toMatchObject({ state: "unavailable", label: "Not available yet" });
    expect(documentStatus({ available: true, current: null, jobs }).state).toBe("needs_check");
  });
});

describe("the rail's 06 Documents / Tender step", () => {
  it("C0 defect 3: an in-app export regenerates the BoQ INSIDE its job — its BoQ is newer than the job, and it still counts", () => {
    // The job was created at 10:00; the BoQ it regenerated (and checked) at 10:01.
    const jobs = [job("j1", "passed", "2026-10-21T10:00:00Z", "boq-2")];
    expect(exportedOn(jobs, "boq-2")).toBe(true);
    expect(exportedOn(jobs, "boq-3")).toBe(false);
    expect(exportedOn([job("j1", "passed", "2026-10-21T10:00:00Z", "boq-2")], "boq-2", { proposal: true })).toBe(false);
    expect(exportedOn([job("j1", "passed", "2026-10-21T10:00:00Z", "boq-2", { options: { proposal: true } })], "boq-2", { proposal: true })).toBe(true);
  });

  const facts = (exported: boolean, persona: "firm" | "owner"): JourneyFacts => ({
    projectId: "p",
    planBlock: null,
    boq: { rev: 2, createdAt: "2026-10-21T10:01:00Z" },
    specSelections: 0,
    owner: { brief: true, moodboardItems: 3, renders: 1, renderViews: { locked: 1, total: 1 }, unpricedLines: 0, exported },
    firm:
      persona === "firm"
        ? { bookStatus: "reviewed", basis: { referenceLines: 0, totalLines: 1 }, gate: { ok: true, reason: null, refusal: null }, upstream: { changed: false, summary: null } as never, approval: { firm: true, client: true }, exported: { pack: exported, proposal: false } }
        : null,
  });

  it("done only when the last export passed on the current revision", () => {
    expect(firmStepStatuses(facts(true, "firm")).documents?.state).toBe("done");
    expect(firmStepStatuses(facts(false, "firm")).documents?.state).toBe("available");
    expect(ownerStepStatuses(facts(true, "owner")).tender?.state).toBe("done");
    expect(ownerStepStatuses(facts(false, "owner")).tender?.state).toBe("available");
  });
});

describe("no badge says Ready from a flag or a timestamp", () => {
  it("the Overview and the hub read documentStatus; the rail never compares job and revision times", () => {
    for (const f of ["lib/hub/overview-view.ts", "lib/hub/hub-view.ts"]) {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      expect(src, f).toMatch(/documentStatus\(/);
      expect(src, f).not.toMatch(/`Ready · rev|"Ready"|Through the export pack · rev|Generated from the plan · rev/);
    }
    const facts = readFileSync(path.join(ROOT, "lib/journey-facts.ts"), "utf8");
    expect(facts).not.toMatch(/created_at\s*>\s*latest/);
    expect(facts).toMatch(/exportedOn\(/);
    const page = readFileSync(path.join(ROOT, "components/blueprint/documents/DocumentsExport.tsx"), "utf8");
    expect(page).toMatch(/const stale = .*boq_id/);
  });
});

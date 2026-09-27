import { describe, expect, it } from "vitest";

import type { BoqApproval } from "@/lib/boq/approvals";
import { assignRefs } from "@/lib/boq/refs";
import { diffRevisions, snapshotRevision, type RevisionBoq } from "@/lib/boq/revision-diff";
import { findWithheldIdentities } from "@/lib/identity/curation";

import { buildRevisionDiffPages } from "../revision-diff-pdf";

// U4 — the diff PDF prints the SAME diff object the page renders: every moved
// line (old → new qty, rate, Δ AED), the recorded causes, the approval trail of
// both revisions, the summary chain — and nothing withheld.

const line = (description: string, quantity: number, rate_aed: number, item_key: string) => ({ description, quantity, unit: "m2", rate_aed, total_aed: Math.round(quantity * rate_aed * 100) / 100, item_key, vendor_or_source: "market reference — Dubai garden 2026" });
const boq = (lines: ReturnType<typeof line>[], draft: boolean): RevisionBoq => {
  const subtotal = lines.reduce((n, l) => n + l.total_aed, 0);
  const contingency_aed = Math.round(subtotal * 0.05);
  const vat_aed = Math.round((subtotal + contingency_aed) * 0.05);
  return { sections: [{ work_section: "Hardscape & Structures", lines, section_total_aed: subtotal }], subtotal_aed: subtotal, contingency_pct: 5, contingency_aed, vat_pct: 5, vat_aed, grand_total_aed: subtotal + contingency_aed + vat_aed, garden: { draft: { draft } } };
};
const b1 = boq([line("PCC base under paving", 60, 105.6, "garden.pcc_base"), line("Porcelain paving installation", 60, 70.4, "garden.paving_install"), line("Old bench", 4, 1320, "garden.bench")], true);
const b2 = boq([line("PCC base under paving", 69.41, 105.6, "garden.pcc_base"), line("Porcelain paving installation", 69.41, 75, "garden.paving_install")], false);
const approval = (over: Partial<BoqApproval>): BoqApproval => ({ id: "a", project_id: "p", boq_id: "b2", firm_id: null, kind: "firm", approved_by: "u", client_name: null, client_date: null, note: null, created_at: "2026-09-27T10:00:00Z", ...over });

describe("buildRevisionDiffPages", () => {
  const diff = diffRevisions(snapshotRevision("b1", "2026-09-01T10:00:00Z", b1), snapshotRevision("b2", "2026-09-02T10:00:00Z", b2), [
    { kind: "correction", at: "2026-09-01T12:00:00Z", summary: "quantity correction 60 → 69.41 — re-measured on site", item_keys: ["garden.pcc_base"] },
    { kind: "regeneration", at: "2026-09-02T10:00:00Z", summary: "this revision was generated — session script", revision_level: true },
  ]);
  const firm = approval({ id: "a1" });
  const client = approval({ id: "a2", kind: "client", client_name: "H. Client", client_date: "2026-09-26", created_at: "2026-09-27T11:00:00Z" });
  const pages = buildRevisionDiffPages({
    projectName: "Arabella Garden — Draft for Review",
    community: "Dubai",
    dateISO: "2026-09-27",
    diff,
    refs: { before: assignRefs(b1.sections), after: assignRefs(b2.sections) },
    approvals: { before: { firm: null, client: null, trail: [] }, after: { firm, client, trail: [firm, client] } },
  });
  const all = pages.join("\n");

  it("is one A4 page here, with the headline delta and both revisions", () => {
    expect(pages).toHaveLength(1);
    expect(all).toMatch(/data-diff-delta="true"/);
    expect(all).toMatch(/data-revision="from"[^>]*>FROM\s+revision b1 · 2026-09-01 · DRAFT/);
    expect(all).toMatch(/data-revision="to"[^>]*>TO\s+revision b2 · 2026-09-02</);
    expect(all).toContain("The draft watermark drops between these revisions");
  });

  it("prints every moved line with its class, old → new figures, REF and Δ AED", () => {
    expect(all).toContain('data-qty="60 → 69.41 m2"');
    expect(all).toContain('data-class="quantity"');
    expect(all).toContain('data-class="both"');
    expect(all).toContain('data-class="removed"');
    expect(all).toMatch(/data-ref="HRD-01"/); // after-revision REF for a surviving line
    expect(all).toMatch(/data-ref="HRD-03†"/); // the removed line keeps its earlier REF, marked
    const deltas = [...all.matchAll(/data-delta-aed="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
    // PCC: (69.41 − 60) × 105.6 = 993.7 · paving: 69.41 × 75 − 60 × 70.4 = 981.75 · bench removed: −5280
    expect(deltas.sort((a, b) => a - b)).toEqual([-5280, 981.75, 993.7]);
  });

  it("prints a cause only where one was recorded, and says so where none was", () => {
    expect(all).toMatch(/data-cause="recorded"[^>]*>Correction recorded · 2026-09-01 — quantity correction 60 → 69.41/);
    expect((all.match(/data-cause="none"/g) ?? []).length).toBe(2); // paving install + the removed bench
    expect(all).toMatch(/data-window-cause="true"[^>]*>2026-09-02 · BoQ regenerated — this revision was generated/);
  });

  it("prints the approval trail of both revisions — the firm as 'the firm', the client as recorded, never a member", () => {
    expect(all).toContain("not approved"); // FROM
    expect(all).toContain("Approved by the firm · 2026-09-27");
    expect(all).toContain("Client approval recorded by the firm · H. Client · 2026-09-26");
    expect(all).not.toContain("alice");
    expect(all).not.toContain("@");
  });

  it("prints the summary chain old → new and no withheld identity", () => {
    for (const label of ["Subtotal", "Contingency", "VAT", "Grand total"]) expect(all).toContain(`data-summary="${label}"`);
    expect(all).not.toContain('data-summary="Overheads');
    expect(findWithheldIdentities(pages, ["Newspace"])).toEqual([]);
  });

  it("an empty diff prints a page that says nothing moved", () => {
    const same = diffRevisions(snapshotRevision("b1", "2026-09-01T10:00:00Z", b1), snapshotRevision("b1", "2026-09-01T10:00:00Z", b1));
    const p = buildRevisionDiffPages({ projectName: "P", community: "Dubai", dateISO: "2026-09-27", diff: same, refs: { before: {}, after: {} }, approvals: { before: { firm: null, client: null, trail: [] }, after: { firm: null, client: null, trail: [] } } });
    expect(p.join("")).toContain("No line moved between these two revisions.");
  });
});

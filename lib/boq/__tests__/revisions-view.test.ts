import { describe, expect, it } from "vitest";

import { classSummary, reconciliation, revisionOptions } from "../revisions-view";

// K4 — Revisions & Approval (R7 §3.5, 21:450): the sentences the screen prints
// about a diff. The J0 session diff: six quantity lines, no causes recorded.

const J0 = [682.18, 454.78, 827.52, -710.16, -1893.76, 0.0];

describe("revisions view", () => {
  it("numbers revisions oldest = rev 1, in Dubai time", () => {
    const opts = revisionOptions([
      { boq_id: "b", created_at: "2026-09-19T00:57:00Z", grand_total_aed: 2, line_count: 1, draft: true, approvals: { firm: null, client: null, trail: [] } },
      { boq_id: "a", created_at: "2026-09-17T16:54:00Z", grand_total_aed: 1, line_count: 1, draft: true, approvals: { firm: null, client: null, trail: [] } },
    ]);
    // ICU spells September "Sep" or "Sept" depending on the runtime's data.
    expect(opts[0]!.label).toMatch(/^rev 2 · 19 Sept? 2026 · 04:57$/);
    expect(opts[1]!.label).toMatch(/^rev 1 · 17 Sept? 2026 · 20:54$/);
    expect(opts.map((o) => o.rev)).toEqual([2, 1]);
  });

  it("summarises what kind of move the lines are", () => {
    expect(classSummary(Array.from({ length: 6 }, () => ({ class: "quantity" as const })))).toBe("all 6 on quantity");
    expect(classSummary([{ class: "quantity" }, { class: "rate" }, { class: "rate" }, { class: "added" }])).toBe("1 on quantity · 2 on rate");
    expect(classSummary([{ class: "added" }])).toBe("");
  });

  it("reconciles the line deltas against the counted subtotal, and names a gap", () => {
    const ok = reconciliation(J0.slice(0, 5), -639.44, false);
    expect(ok).toBe("+682.18 + 454.78 + 827.52 − 710.16 − 1,893.76 = −639.44 = Δ counted subtotal · contingency and VAT follow on the subtotal, each rounded once to the fil (H7).");
    const gap = reconciliation([10, 5], 16, true);
    expect(gap).toContain("but the counted subtotal moved +16.00");
    expect(gap).toContain("+1.00 is not explained by a line");
    expect(reconciliation([], 0, false)).toBe("No line moved, and the counted subtotal is unchanged.");
  });
});

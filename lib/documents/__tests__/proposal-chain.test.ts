import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildReviewModel, type ReviewBoq } from "@/lib/boq/review-model";
import { predatesRounding } from "@/lib/boq/revision-diff";
import { reroundRevision, summaryChainOf } from "@/lib/boq/totals";

import type { BoqPdfInput } from "../boq-pdf";
import { proposalChecklistItems } from "../pack-export/checklist";
import { buildProposalPages } from "../proposal";
import { PRE_ROUNDING_REFUSAL, proposalGateVerdict, referenceBasisOf } from "../reference-basis";

// K10 #3 — the proposal reconciles to the fil with the BoQ page. QA saw the
// proposal print 102,892.07 / 8,231.00 / 5,556.00 / 116,679.07 beside a BoQ
// page at 102,892.03 / 8,231.36 / 5,556.17 / 116,679.56: the same project, two
// revisions — a pre-H7 one (engine 0.2.0, whole-dirham contingency and VAT) in
// the proposal, the regenerated H7 one on the page. Now both surfaces read ONE
// chain (summaryChainOf) of the same revision, and a pre-H7 revision is not
// issued until it is regenerated.
const ROOT = path.resolve(__dirname, "../../..");
const fx = JSON.parse(readFileSync(path.join(ROOT, "lib/boq/__fixtures__/arabella-g5d-revisions.json"), "utf8")) as { stages: { boq_id: string; label?: string }[]; boqs: Record<string, BoqPdfInput["boq"] & { engine?: { version?: string } }> };
const revisions = [...new Set(fx.stages.map((s) => s.boq_id))].map((id) => [id, fx.boqs[id]!] as const);

/** The four printed figures of a proposal (data-value / data-grand-total on its price summary). */
function printed(pages: string[]) {
  const all = pages.join("\n");
  const v = (k: string) => Number(new RegExp(`data-summary="${k}" data-value="([0-9.]+)"`).exec(all)?.[1]);
  return { subtotal: v("subtotal"), contingency: v("contingency"), vat: v("vat"), grand: Number(/data-grand-total="([0-9.]+)"/.exec(all)?.[1]) };
}

/** The four figures the BoQ page shows for the same revision (its review model). */
function onPage(boq: ReviewBoq) {
  const m = buildReviewModel({ projectId: "p", boqId: "b", rev: 1, revDate: "2026-10-13", persona: "firm", boq, provenance: null, tierCtx: { qsValidated: {} }, firm: null, basis: null, duplicates: [], budget: null });
  return { subtotal: m.chain.subtotal, contingency: m.chain.contingency.amount, vat: m.chain.vat.amount, grand: m.chain.grand };
}

const proposal = (boq: BoqPdfInput["boq"]) =>
  buildProposalPages({ brand: "Scratch Landscapes & Co.", logoDataUri: null, termsText: null, projectName: "Garden — Draft for Review", community: "Dubai", dateISO: "2026-10-13", rooms: [], boq, reference: "SL-P-0001" });

describe("the proposal reconciles to the fil with the BoQ page", () => {
  it.each(revisions.map(([id, b]) => [id.slice(0, 8), b]))("revision %s: every fixture revision predates H7 and is refused with the reason", (_id, b) => {
    expect(predatesRounding(b.engine?.version)).toBe(true);
    const v = proposalGateVerdict({ basis: referenceBasisOf(b as never), bookStatus: "reviewed", accepted: true, preRounding: true });
    expect(v).toEqual({ ok: false, reason: null, refusal: PRE_ROUNDING_REFUSAL });
    expect(PRE_ROUNDING_REFUSAL).toBe("Regenerate first — this revision predates the rounding fix.");
  });

  it.each(revisions.map(([id, b]) => [id.slice(0, 8), b]))("revision %s, regenerated: proposal subtotal / contingency / VAT / total == the BoQ page's", (_id, b) => {
    const regen = reroundRevision(b);
    expect(predatesRounding(regen.engine?.version)).toBe(false);
    const p = printed(proposal(regen));
    const page = onPage(regen as unknown as ReviewBoq);
    expect(p).toEqual(page);
    // …and the column adds up to the fil.
    expect(Math.round((p.subtotal + p.contingency + p.vat) * 100)).toBe(Math.round(p.grand * 100));
    // One reader: both are the stored chain of that revision.
    const c = summaryChainOf(regen);
    expect(page).toEqual({ subtotal: c.subtotal, contingency: c.contingency, vat: c.vat, grand: c.grand });
  });

  it("the QA's numbers: stage 7 regenerated is the H7 revision the BoQ page showed (102,892.03 / 8,231.36 / 5,556.17 / 116,679.56)", () => {
    const stage7 = fx.boqs[fx.stages[7]!.boq_id]!;
    // The stale proposal's figures were the pre-H7 revision's own.
    expect(summaryChainOf(stage7)).toMatchObject({ subtotal: 102892.07, contingency: 8231, vat: 5556, grand: 116679.07 });
    expect(printed(proposal(reroundRevision(stage7)))).toEqual({ subtotal: 102892.03, contingency: 8231.36, vat: 5556.17, grand: 116679.56 });
  });

  it("the gate refuses before it looks at the basis; the export checklist names the fix", () => {
    const b = reroundRevision(fx.boqs[fx.stages[7]!.boq_id]!);
    expect(proposalGateVerdict({ basis: referenceBasisOf(b as never), bookStatus: "reviewed", accepted: false })).toMatchObject({ ok: true });
    const firm = { brand: "Scratch", logo_path: null, terms_text: "t", book_status: "reviewed" as const };
    const items = proposalChecklistItems("p1", { firm, boq: { id: "b", basis: { basis: "reference", reference_lines: 6, firm_lines: 0, total_lines: 18 } }, acceptance: null, verdict: { ok: false, reason: null, refusal: PRE_ROUNDING_REFUSAL }, preRounding: true });
    const r = items.find((i) => i.key === "proposal_rounding")!;
    expect(r).toMatchObject({ ok: false, detail: PRE_ROUNDING_REFUSAL, fix: { label: "Regenerate on the BoQ page", href: "/project/p1/boq" } });
  });

  it("both surfaces read the chain through summaryChainOf (static)", () => {
    for (const f of ["lib/documents/proposal.ts", "lib/boq/review-model.ts"]) expect(readFileSync(path.join(ROOT, f), "utf8")).toContain("summaryChainOf(");
    expect(readFileSync(path.join(ROOT, "lib/documents/proposal-gate.ts"), "utf8")).toContain("predatesRounding(");
  });
});

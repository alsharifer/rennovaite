import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findWithheldIdentities } from "@/lib/identity/curation";

import type { BoqPdfInput } from "../boq-pdf";
import { printedChecks } from "../pack-export/checks";
import { proposalChecklistItems } from "../pack-export/checklist";
import { buildProposalPages, type ProposalInput } from "../proposal";
import { PREPARED_WITH_MARK } from "../reference-basis-types";

// L4 — the firm's client proposal: the firm is the brand, the BoQ prints at the
// firm's rates with OH&P as its own row, no rate provenance reaches the client,
// the draft watermark carries over, and the leak scan is clean.

const ROOT = path.resolve(__dirname, "../../..");
const fx = JSON.parse(fs.readFileSync(path.join(ROOT, "lib/boq/__fixtures__/arabella-g5d-revisions.json"), "utf8")) as { stages: { boq_id: string }[]; boqs: Record<string, BoqPdfInput["boq"]> };
const arabella = fx.boqs[fx.stages[7]!.boq_id]!;
// A 1×1 PNG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const input = (over: Partial<ProposalInput> = {}): ProposalInput => ({
  brand: "Scratch Landscapes & Co.",
  logoDataUri: PNG,
  termsText: "Valid for 30 days.\n\nPayment: 40% on order, 50% on completion, 10% on handover.",
  projectName: "Garden — Draft for Review",
  community: "Dubai",
  dateISO: "2026-09-27",
  rooms: [{ name: "Rear lawn", kind: "artificial_grass", area_m2: 47.8 }, { name: "Entrance paving", kind: "paving", area_m2: 12.3 }],
  boq: arabella,
  ...over,
});

const text = (pages: string[]) => pages.map((p) => p.replace(/<[^>]+>/g, " ")).join(" ");

describe("buildProposalPages", () => {
  const pages = buildProposalPages(input());
  const all = pages.join("\n");

  it("cover: the firm's brand and logo, the project, the contract sum in the derived convention", () => {
    expect(pages[0]).toContain('data-proposal-cover="true"');
    expect(pages[0]).toContain('data-logo="present"');
    expect(pages[0]).toContain("<image ");
    expect(pages[0]).toContain(">Scratch Landscapes &amp; Co.<");
    expect(pages[0]).toContain(`data-grand-total="${arabella.grand_total_aed}"`);
    expect(pages[0]).toMatch(/≈ AED [\d,]+\*/); // derived total, never a bare number
    expect(pages[0]).toContain('data-headline-excludes="true"'); // D4: the QS-to-price lines are named
  });

  it("the firm is the brand: no RennovAIte heading; only the discreet mark, on every page", () => {
    for (const p of pages) expect(p).toContain('data-prepared-with="true"');
    expect(all).toContain(PREPARED_WITH_MARK);
    expect(all).not.toMatch(/font-size="(?:[4-9]|\d{2})[\d.]*"[^>]*>[^<]*RennovAIte/);
    for (const p of pages.slice(1)) expect(p).toContain('data-firm-brand="header"');
  });

  it("the BoQ at the firm's rates: every line with its REF, no source, no tier, no QS mark", () => {
    const lines = arabella.sections.reduce((n, s) => n + s.lines.length, 0);
    expect((all.match(/data-ref="/g) ?? []).length).toBe(lines);
    expect(text(pages)).not.toMatch(/market reference|contractor rate book|indicative rate|QS to price|actual_transaction|Source:/i);
    // Derived quantities keep their honesty flag.
    expect(all).toMatch(/>≈ [\d.]+</);
  });

  it("draft watermark on every page, programme and terms pages present, scope summary printed", () => {
    for (const p of pages) expect(p).toContain('data-boq-draft="true"');
    expect(all).toContain("data-programme-phase");
    expect((all.match(/data-terms="true"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(all).toContain('data-scope="true"');
    expect(text(pages)).toContain("Rear lawn (47.8 m²)");
  });

  it("OH&P prints as its own row when the BoQ carries it; a logo-less firm prints no image", () => {
    const withOhp = { ...arabella, ohp_pct: 12, ohp_aed: 12345 };
    const p = buildProposalPages(input({ boq: withOhp, logoDataUri: null, termsText: null }));
    expect(p.join("")).toContain('data-ohp="12345"');
    expect(p.join("")).toContain("Overheads &amp; profit 12%");
    expect(p[0]).toContain('data-logo="none"');
    expect(p[0]).not.toContain("<image ");
    expect(p.join("")).not.toContain('data-terms="true"');
  });

  it("leak scan: the firm's own brand is allowed; withheld names and contractor identities are absent", () => {
    expect(findWithheldIdentities(pages, ["Newspace", "KAME"])).toEqual([]);
    expect(findWithheldIdentities(pages, ["Scratch Landscapes & Co."])).toEqual(["Scratch Landscapes & Co."]); // it IS printed — the scan would catch another firm's
  });

  it("the printed-content checks accept it and refuse a proposal that prints provenance", () => {
    const base = { scope: "garden" as const, draftStatement: (arabella.garden!.draft!.statement ?? null) as string | null, boq: arabella as never, sheets: [], packPages: [], packPageKinds: [], boqPages: null, boqHtml: "", planHtml: null, parity: null, identityTokens: [], withheldNames: ["Newspace"], publicSourceLabel: "market reference — Dubai garden 2026", renders: null, pairsWithAdds: [] };
    const ok = printedChecks({ ...base, proposal: { pages, brand: "Scratch Landscapes & Co.", terms: true, basis: "accepted" } }).filter((c) => /proposal/.test(c.label));
    expect(ok.length).toBeGreaterThanOrEqual(8);
    expect(ok.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`)).toEqual([]);
    const leaky = pages.map((p, i) => (i === 1 ? p.replace("PRICED SCHEDULE", "PRICED SCHEDULE (market reference)") : p));
    const bad = printedChecks({ ...base, proposal: { pages: leaky, brand: "Scratch Landscapes & Co.", terms: true, basis: null } }).filter((c) => !c.ok);
    expect(bad.map((c) => c.label)).toEqual(expect.arrayContaining(["the proposal prints no rate provenance (sources, tiers, QS marks)", "the proposal's pricing basis was a stated choice"]));
  });
});

describe("proposalChecklistItems", () => {
  const firm = { brand: "Scratch Landscapes", logo_path: null, terms_text: "t", book_status: "draft" as const };
  const boq = { id: "b1", basis: { basis: "reference", reference_lines: 15, firm_lines: 0, total_lines: 18 } };

  it("no firm → the firm item blocks and nothing else is asked", () => {
    const items = proposalChecklistItems("p1", { firm: null, boq, acceptance: null, verdict: { ok: false, reason: null, refusal: "no firm" } });
    expect(items.map((i) => [i.key, i.ok])).toEqual([["proposal_firm", false]]);
  });

  it("reference basis open → a blocking item that names the counts and links to the BoQ page's accept control", () => {
    const items = proposalChecklistItems("p1", { firm, boq, acceptance: null, verdict: { ok: false, reason: null, refusal: "15 of 18 lines …" } });
    const rb = items.find((i) => i.key === "reference_basis")!;
    expect(rb.ok).toBe(false);
    expect(rb.items).toEqual(["15 of 18 lines priced from the market reference", "0 from the firm's book"]);
    expect(rb.fix).toEqual({ label: "Open the BoQ", href: "/project/p1/boq#reference-basis" });
    expect(items.find((i) => i.key === "branding")).toMatchObject({ ok: true });
    expect(items.find((i) => i.key === "branding")!.detail).toContain("(no logo uploaded)");
  });

  it("accepted / reviewed → the item passes and says which", () => {
    const acc = proposalChecklistItems("p1", { firm, boq, acceptance: { created_at: "2026-09-27T10:00:00Z" }, verdict: { ok: true, reason: "accepted", refusal: null } }).find((i) => i.key === "reference_basis")!;
    expect(acc.ok).toBe(true);
    expect(acc.detail).toContain("accepted this basis for this BoQ revision on 2026-09-27");
    const rev = proposalChecklistItems("p1", { firm: { ...firm, book_status: "reviewed" }, boq, acceptance: null, verdict: { ok: true, reason: "book_reviewed", refusal: null } }).find((i) => i.key === "reference_basis")!;
    expect(rev.detail).toContain("marked reviewed");
  });
});

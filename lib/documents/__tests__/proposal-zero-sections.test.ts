import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { reroundRevision } from "@/lib/boq/totals";

import type { BoqPdfInput } from "../boq-pdf";
import { buildProposalPages, clientSections } from "../proposal";

// K10 #8 — client documents hide zero-value sections. Arabella's stage 7 has a
// Plumbing section of two lines, both still to be priced (total 0.00): the
// proposal printed "Plumbing 0.00" in its price summary and an empty section in
// its schedule. Those lines stay named — in Exclusions & to be priced and in
// the total's sentence — and the summary still adds up to the subtotal.
const ROOT = path.resolve(__dirname, "../../..");
const fx = JSON.parse(readFileSync(path.join(ROOT, "lib/boq/__fixtures__/arabella-g5d-revisions.json"), "utf8")) as { stages: { boq_id: string }[]; boqs: Record<string, BoqPdfInput["boq"]> };
const boq = reroundRevision(fx.boqs[fx.stages[7]!.boq_id]!);
const setup = { clientLabel: "The client", validity: "Valid for 30 days", paymentTerms: "On order", coverNote: null, showLineRates: false };
const pages = buildProposalPages({ brand: "Scratch Landscapes & Co.", logoDataUri: null, termsText: null, projectName: "Garden", community: "Dubai", dateISO: "2026-10-13", rooms: [], boq, ...setup });
const all = pages.join("\n");
const text = all.replace(/<[^>]+>/g, " ");

describe("client documents hide zero-value sections", () => {
  it("the fixture has one: Plumbing, every line to be priced", () => {
    const plumbing = boq.sections.find((s) => s.work_section === "Plumbing")!;
    expect(plumbing.section_total_aed).toBe(0);
    expect(clientSections(boq.sections).map((s) => s.work_section)).not.toContain("Plumbing");
    expect(clientSections(boq.sections)).toHaveLength(boq.sections.length - 1);
  });

  it("the price summary and the schedule leave it out; the scope sentence counts what is shown", () => {
    expect(all).not.toContain('data-section-total="Plumbing"');
    expect(text).toMatch(/6 work sections/);
    expect(text).not.toMatch(/·\s*Plumbing\s*·/);
  });

  it("its lines stay named, and the printed section totals still add up to the subtotal", () => {
    expect(text).toMatch(/Outdoor water tap/);
    expect(text).toMatch(/Drainage point/);
    const totals = [...all.matchAll(/data-section-total="[^"]+"[^>]*>([0-9,]+\.[0-9]{2})</g)].map((m) => Number(m[1]!.replace(/,/g, "")));
    expect(totals).toHaveLength(6);
    expect(Math.round(totals.reduce((a, b) => a + b, 0) * 100)).toBe(Math.round(boq.subtotal_aed * 100));
  });

  it("the 08 Proposal screen's preview uses the same list", () => {
    expect(readFileSync(path.join(ROOT, "lib/documents/proposal-view.ts"), "utf8")).toContain("clientSections(boq.sections)");
  });
});

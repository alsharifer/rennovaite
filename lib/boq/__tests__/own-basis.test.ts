import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type { Caller } from "@/lib/auth/caller";
import { isUnpricedLine } from "@/lib/documents/boq-derived";
import { referenceBasisOf } from "@/lib/documents/reference-basis";
import { fakeDb, type FakeDb } from "@/lib/firms/__tests__/fake-db";
import { tierOf } from "@/lib/provenance/tier";

import { applyCorrection, revertToRevision } from "../apply-correction";
import { stableLineKeys } from "../line-identity";
import { lineTotal, sumMoney } from "../money";
import { applyOwnBasis, type AppliedCorrection, type OwnBasisDoc } from "../own-basis";
import { loadAppliedCorrections } from "../own-basis-load";
import { OWN_PRICE_TIER } from "../own-basis-vocab";
import { chainTotals, reroundRevision } from "../totals";

// K11 #4 (spec §7.3, migration 057) — a price added on review / an applied
// correction enters the next revision: the line moves into the counted total,
// the subtotal moves by EXACTLY qty × rate, the chain recomputes to the fil,
// and a revert restores the previous totals. On the Arabella G5d stage-7
// revision (H7-rounded): 102,892.03 · 8,231.36 · 5,556.17 · 116,679.56,
// three lines to be priced (PLB-01 outdoor tap 2 no, PLB-02 drainage 2 no,
// SFT-03 planting 23.74 m²).

type Doc = OwnBasisDoc & { sections: { work_section: string; lines: (OwnBasisDoc["sections"][number]["lines"][number] & Record<string, unknown>)[]; section_total_aed: number }[] };
const fx = JSON.parse(readFileSync(path.resolve(__dirname, "../__fixtures__/arabella-g5d-revisions.json"), "utf8"));
const stage7 = (): Doc => reroundRevision(fx.boqs[fx.stages[7].boq_id]) as Doc;
const line = (d: Doc, section: string, i: number) => d.sections.find((s) => s.work_section === section)!.lines[i]!;
const keyOf = (d: Doc, section: string, i: number) => stableLineKeys(d.sections)[`${section}-${i}`]!;
const tap = (d: Doc, value = 650, over: Partial<AppliedCorrection> = {}): AppliedCorrection => ({
  id: "c-tap",
  type: "rate",
  lineKey: keyOf(d, "Plumbing", 0),
  value,
  origin: "add_price",
  basisKind: "supplier_quote",
  note: "Oct 2026",
  byName: "Abdallah",
  appliedAt: "2026-10-13T10:00:00.000Z",
  ...over,
});

describe("applyOwnBasis — the pure overlay", () => {
  it("the fixture is what the brief says: 116,679.56 with 3 lines to be priced", () => {
    const d = stage7();
    expect([d.subtotal_aed, d.contingency_aed, d.vat_aed, d.grand_total_aed]).toEqual([102892.03, 8231.36, 5556.17, 116679.56]);
    expect(d.sections.flatMap((s) => s.lines).filter((l) => isUnpricedLine(l as never))).toHaveLength(3);
  });

  it("unpriced → priced: the line joins the counted total and the subtotal moves by exactly qty × rate", () => {
    const before = stage7();
    const { boq: after, applied, missing } = applyOwnBasis(before, [tap(before, 650)]);
    expect(applied).toEqual(["c-tap"]);
    expect(missing).toEqual([]);
    const l = line(after, "Plumbing", 0);
    expect(l).toMatchObject({ rate_aed: 650, total_aed: 1300, rate_status: "priced", rate_tier: OWN_PRICE_TIER, quantity: 2 });
    expect(isUnpricedLine(l as never)).toBe(false);
    expect(after.subtotal_aed).toBe(sumMoney([before.subtotal_aed, lineTotal(2, 650)])); // 104,192.03
    expect(after.subtotal_aed).toBe(104192.03);
    // The chain recomputes to the fil from the new subtotal (contingency 8%, VAT 5%).
    const c = chainTotals({ subtotal_aed: 104192.03, contingency_pct: 8, vat_pct: 5 });
    expect([after.contingency_aed, after.vat_aed, after.grand_total_aed]).toEqual([c.contingency_aed, c.vat_aed, c.grand_total_aed]);
    expect(after.grand_total_aed).toBe(sumMoney([after.subtotal_aed, after.contingency_aed, after.vat_aed]));
    // Nothing else moved.
    const others = (d: Doc) => d.sections.flatMap((s) => s.lines.map((x, i) => (s.work_section === "Plumbing" && i === 0 ? null : [s.work_section, x.total_aed])));
    expect(others(after)).toEqual(others(before));
    expect(before.grand_total_aed).toBe(116679.56); // the input is untouched
  });

  it("the line is YOUR PRICE: own basis (measured), basis recorded, counted as the project's own basis", () => {
    const d = stage7();
    const l = line(applyOwnBasis(d, [tap(d)]).boq, "Plumbing", 0);
    expect(tierOf(l as never, "Plumbing")).toMatchObject({ rate: "measured", qty: "measured", amount: "measured" });
    expect(l.price_basis).toEqual({ correction_id: "c-tap", origin: "add_price", kind: "supplier_quote", note: "Oct 2026", by: "Abdallah", at: "2026-10-13T10:00:00.000Z" });
    const basis = referenceBasisOf(applyOwnBasis(d, [tap(d)]).boq as never);
    expect(basis.firm_lines).toBe(referenceBasisOf(d as never).firm_lines + 1);
  });

  it("the line keeps its identity, so a later revision still finds it (the aside stays when it names the line)", () => {
    const d = stage7();
    const after = applyOwnBasis(d, [tap(d)]).boq;
    expect(keyOf(after, "Plumbing", 0)).toBe(keyOf(d, "Plumbing", 0));
    // Applying the same corrections to the applied revision is idempotent.
    expect(applyOwnBasis(after, [tap(after)]).boq.grand_total_aed).toBe(after.grand_total_aed);
  });

  it("a quantity correction: measured quantity, total = qty × the line's rate, chain recomputed", () => {
    const d = stage7();
    const pergola = line(d, "Hardscape & Structures", 5);
    const q: AppliedCorrection = { ...tap(d), id: "c-q", type: "quantity", origin: "correction", lineKey: keyOf(d, "Hardscape & Structures", 5), value: 12, basisKind: null, note: "Site measurement" };
    const after = applyOwnBasis(d, [q]).boq;
    const l = line(after, "Hardscape & Structures", 5);
    expect(l).toMatchObject({ quantity: 12, total_aed: lineTotal(12, pergola.rate_aed), qty_derived: false });
    expect(after.subtotal_aed).toBe(Math.round((d.subtotal_aed + l.total_aed - pergola.total_aed) * 100) / 100);
    expect(tierOf(l as never, "Hardscape & Structures").qty).toBe("measured");
  });

  it("a line no longer in the BoQ is reported missing — the document is untouched", () => {
    const d = stage7();
    const out = applyOwnBasis(d, [tap(d, 650, { lineKey: "Plumbing|nothing" })]);
    expect(out).toMatchObject({ applied: [], missing: ["c-tap"] });
    expect(out.boq).toBe(d);
  });
});

describe("applyCorrection / revertToRevision — the next revision, and undo", () => {
  const member: Caller = { id: "00000000-0000-4000-8000-0000000000a1", email: "abdallah@owner.test" };
  let db: FakeDb;
  let rev1: string;
  beforeEach(() => {
    const d = stage7();
    rev1 = "b0000000-0000-4000-8000-000000000001";
    db = fakeDb({
      projects: [{ id: "p1", name: "Garden", firm_id: null }],
      boqs: [{ id: rev1, project_id: "p1", total_aed: d.grand_total_aed, sections: d, created_at: "2026-10-13T08:00:00.000Z" }],
      boq_corrections: [],
      pilot_events: [],
    });
  });
  const latest = () => [...db.tables.boqs!].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).at(-1)!;

  it("Add a price → rev 2 stored with the line priced; the subtotal moved by exactly 2 × 650.00 and the chain to the fil", async () => {
    const r = await applyCorrection(db.client, "p1", member, { boqId: rev1, rowKey: "Plumbing-0", type: "rate", value: 650, origin: "add_price", basisKind: "supplier_quote", note: "Oct 2026", lineRef: "PLB-01" });
    expect(r).toMatchObject({ rev: 2, previousBoqId: rev1, previousTotal: 116679.56 });
    const doc = latest().sections as Doc;
    expect(latest().id).toBe(r.boqId);
    expect(doc.subtotal_aed).toBe(104192.03);
    expect(r.total).toBe(doc.grand_total_aed);
    expect(Number(latest().total_aed)).toBe(doc.grand_total_aed);
    const c = db.tables.boq_corrections![0]!;
    expect(c).toMatchObject({ origin: "add_price", correction_type: "rate", new_value: 650, old_value: 0, basis_kind: "supplier_quote", line_ref: "PLB-01", applied_boq_id: r.boqId, applied_from_boq_id: rev1, applied_by: member.id, applied_by_name: "abdallah" });
    expect(c.line_key).toBe(keyOf(stage7(), "Plumbing", 0));
    expect(db.tables.pilot_events!.map((e) => `${e.kind}:${(e.detail as Record<string, unknown>)?.trigger ?? ""}`)).toEqual(["correction:", "boq_generated:apply_correction"]);
    // What a regeneration would re-apply.
    expect((await loadAppliedCorrections(db.client, "p1")).map((x) => x.id)).toEqual([c.id]);
  });

  it("a newer revision refuses: 409 stale_revision", async () => {
    await applyCorrection(db.client, "p1", member, { boqId: rev1, rowKey: "Plumbing-0", type: "rate", value: 650, origin: "add_price" });
    await expect(applyCorrection(db.client, "p1", member, { boqId: rev1, rowKey: "Plumbing-1", type: "rate", value: 90, origin: "add_price" })).rejects.toMatchObject({ status: 409, code: "stale_revision" });
  });

  it("a second price keeps the first; revert to rev 1 restores the previous totals exactly and stops both applying", async () => {
    const a = await applyCorrection(db.client, "p1", member, { boqId: rev1, rowKey: "Plumbing-0", type: "rate", value: 650, origin: "add_price" });
    const b = await applyCorrection(db.client, "p1", member, { boqId: a.boqId, rowKey: "Soft Landscaping-2", type: "rate", value: 85, origin: "add_price", basisKind: "own_estimate" });
    const two = latest().sections as Doc;
    expect(line(two, "Plumbing", 0).total_aed).toBe(1300); // the first price is still there
    expect(line(two, "Soft Landscaping", 2).total_aed).toBe(lineTotal(23.74, 85));
    expect(two.subtotal_aed).toBe(sumMoney([102892.03, 1300, lineTotal(23.74, 85)]));
    expect(b.rev).toBe(3);

    const r = await revertToRevision(db.client, "p1", member, rev1);
    expect(r).toMatchObject({ rev: 4, toRev: 1, previousBoqId: b.boqId });
    const back = latest().sections as Doc;
    expect([back.subtotal_aed, back.contingency_aed, back.vat_aed, back.grand_total_aed]).toEqual([102892.03, 8231.36, 5556.17, 116679.56]);
    expect(r.reverted.sort()).toEqual(db.tables.boq_corrections!.map((c) => c.id as string).sort());
    expect(db.tables.boq_corrections!.every((c) => !!c.reverted_at && c.reverted_by_boq_id === r.boqId)).toBe(true);
    expect(await loadAppliedCorrections(db.client, "p1")).toEqual([]); // a regeneration brings neither back
    expect(db.tables.boqs).toHaveLength(4); // nothing deleted
  });

  it("a saved correction (save for review only) can be applied later from its row", async () => {
    db.tables.boq_corrections!.push({ id: "c0000000-0000-4000-8000-000000000001", project_id: "p1", correction_type: "rate", new_value: 1250, old_value: 1366.69, note: "Firm quote", line_key: null, origin: "correction", applied_boq_id: null, reverted_at: null, recorded_at: "2026-10-13T09:00:00.000Z", line_description: "Hardscape & Structures — Motorized louvered pergola (alum, LED, coated)" });
    const r = await applyCorrection(db.client, "p1", member, { boqId: rev1, correctionId: "c0000000-0000-4000-8000-000000000001", rowKey: "Hardscape & Structures-5" });
    const doc = latest().sections as Doc;
    expect(line(doc, "Hardscape & Structures", 5)).toMatchObject({ rate_aed: 1250, total_aed: 15312.5, rate_tier: OWN_PRICE_TIER });
    expect(doc.subtotal_aed).toBe(Math.round((102892.03 - 16741.95 + 15312.5) * 100) / 100);
    expect(r.rev).toBe(2);
    await expect(applyCorrection(db.client, "p1", member, { boqId: r.boqId, correctionId: "c0000000-0000-4000-8000-000000000001" })).rejects.toMatchObject({ code: "already_applied" });
  });

  it("a scope correction has no figure to apply", async () => {
    db.tables.boq_corrections!.push({ id: "c0000000-0000-4000-8000-000000000002", project_id: "p1", correction_type: "scope", new_value: null, line_key: null });
    await expect(applyCorrection(db.client, "p1", member, { boqId: rev1, correctionId: "c0000000-0000-4000-8000-000000000002" })).rejects.toMatchObject({ status: 422, code: "not_applicable" });
  });
});

describe("the wiring (static)", () => {
  const ROOT = path.resolve(__dirname, "../../..");
  const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

  it("every regeneration re-applies the project's applied corrections, before OH&P", () => {
    const src = read("lib/boq/assemble.ts");
    const at = src.indexOf("applyOwnBasis(gardened");
    expect(at).toBeGreaterThan(0);
    expect(src.indexOf("await loadAppliedCorrections(supabase, projectId)")).toBeGreaterThan(0);
    expect(at).toBeLessThan(src.indexOf("return applyOhp(owned, firm.ohpPct)"));
  });

  it("the inspector offers Add a price on an unpriced line and Apply / Save on a correction", () => {
    const ins = read("components/blueprint/boq/Inspector.tsx");
    expect(ins).toMatch(/testId="add-a-price"/);
    const form = read("components/blueprint/boq/CorrectionsTab.tsx");
    expect(form).toMatch(/Apply to this BoQ now/);
    expect(form).toMatch(/Save for review only/);
    expect(form).toMatch(/useState\(!firm\)/); // owner default apply, firm default save
    expect(form).not.toMatch(/never changes this BoQ by itself/);
  });
});

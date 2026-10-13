import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type { Caller } from "@/lib/auth/caller";
import { isUnpricedLine } from "@/lib/documents/boq-derived";
import { referenceBasisOf } from "@/lib/documents/reference-basis";
import { fakeDb, type FakeDb } from "@/lib/firms/__tests__/fake-db";
import { tierOf } from "@/lib/provenance/tier";

import { applyCorrection, releaseCorrection, revertToRevision } from "../apply-correction";
import { stableLineKeys } from "../line-identity";
import { lineTotal, sumMoney } from "../money";
import { applyOwnBasis, type AppliedCorrection, type OwnBasisDoc } from "../own-basis";
import { loadAppliedCorrections } from "../own-basis-load";
import { OWN_PRICE_TIER } from "../own-basis-vocab";
import { assignRefs } from "../refs";
import { chainTotals, rechain, reroundRevision } from "../totals";

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

  it("a line no longer in the BoQ: unmatched — recorded on the document, figures untouched, nothing priced", () => {
    const d = stage7();
    const out = applyOwnBasis(d, [tap(d, 650, { lineKey: "Plumbing|nothing", label: "Plumbing — Outdoor tap" })]);
    expect(out).toMatchObject({ applied: [], missing: ["c-tap"] });
    expect(out.boq.own_basis?.unmatched).toEqual([expect.objectContaining({ correction_id: "c-tap", label: "Plumbing — Outdoor tap", type: "rate", value: 650 })]);
    expect([out.boq.subtotal_aed, out.boq.grand_total_aed]).toEqual([d.subtotal_aed, d.grand_total_aed]);
    expect(out.boq.sections.flatMap((x) => x.lines).some((l) => l.rate_tier === OWN_PRICE_TIER)).toBe(false);
  });
});

// K11 approval check 1: an applied price follows its LINE (item_key, + room when the line
// has one) across a regenerate — never its REF or position; a line that is gone is
// unmatched and surfaced, never dropped silently or attached elsewhere.
describe("regenerate after a scope change that renumbers REFs", () => {
  const plantingKey = (d: Doc) => keyOf(d, "Soft Landscaping", 2);
  const price = (d: Doc): AppliedCorrection => ({ ...tap(d, 85), id: "c-plant", lineKey: plantingKey(d), label: "Soft Landscaping — Planting beds — soil preparation and planting" });
  /** The regenerated document: a new line ahead of the planting beds (SFT-03 → SFT-04) and one line gone elsewhere. */
  const rescoped = (d: Doc): Doc => {
    const sections = d.sections.map((x) => {
      if (x.work_section === "Soft Landscaping") return { ...x, lines: [{ description: "New tree (specimen)", quantity: 2, unit: "no", rate_aed: 0, total_aed: 0, rule_id: "GL-29", item_key: "garden.tree", rate_status: "needs_qs", vendor_or_source: "x", notes: null }, ...x.lines] };
      if (x.work_section === "Preliminaries") return { ...x, lines: x.lines.slice(1) };
      return x;
    });
    return rechain({ ...d, sections } as never) as Doc;
  };

  it("the price stays on the planting beds, now SFT-04 — the line now at SFT-03 is untouched", () => {
    const d = stage7();
    const refsBefore = assignRefs(d.sections);
    expect(refsBefore["Soft Landscaping-2"]).toBe("SFT-03");
    const regen = rescoped(d);
    const refsAfter = assignRefs(regen.sections);
    expect(refsAfter["Soft Landscaping-3"]).toBe("SFT-04"); // the planting beds' REF moved
    const out = applyOwnBasis(regen, [price(d)]);
    expect(out.applied).toEqual(["c-plant"]);
    const beds = line(out.boq, "Soft Landscaping", 3);
    expect(beds.description).toMatch(/^Planting beds/);
    expect(beds).toMatchObject({ rate_aed: 85, rate_tier: OWN_PRICE_TIER, total_aed: lineTotal(23.74, 85) });
    const nowSft03 = line(out.boq, "Soft Landscaping", 2);
    expect(nowSft03.description).not.toMatch(/^Planting beds/);
    expect(nowSft03.rate_tier).not.toBe(OWN_PRICE_TIER);
    expect(out.boq.own_basis).toBeUndefined();
  });

  it("the planting beds gone from the scope → unmatched and recorded, never priced onto another line", () => {
    const d = stage7();
    const gone = rescoped(d);
    gone.sections = gone.sections.map((x) => (x.work_section === "Soft Landscaping" ? { ...x, lines: x.lines.filter((l) => !/^Planting beds/.test(l.description)) } : x));
    const before = rechain(gone as never) as Doc;
    const out = applyOwnBasis(before, [price(d)]);
    expect(out).toMatchObject({ applied: [], missing: ["c-plant"] });
    expect(out.boq.own_basis?.unmatched.map((u) => u.correction_id)).toEqual(["c-plant"]);
    expect(out.boq.sections.flatMap((x) => x.lines).some((l) => l.rate_tier === OWN_PRICE_TIER)).toBe(false);
    expect(out.boq.grand_total_aed).toBe(before.grand_total_aed);
  });

  it("an identity on two lines is ambiguous → unmatched, never guessed; a per-room line keys on its room", () => {
    const d = stage7();
    const twice: Doc = { ...d, sections: d.sections.map((x) => (x.work_section === "Plumbing" ? { ...x, lines: [x.lines[0]!, { ...x.lines[0]! }, ...x.lines.slice(1)] } : x)) };
    expect(applyOwnBasis(twice, [tap(d)]).missing).toEqual(["c-tap"]);
    // Per-room lines: the same item in two rooms are two identities.
    const rooms: Doc = { ...d, sections: d.sections.map((x) => (x.work_section === "Plumbing" ? { ...x, lines: [{ ...x.lines[0]!, room_id: "r-kitchen" }, { ...x.lines[0]!, room_id: "r-terrace" }, ...x.lines.slice(1)] } : x)) };
    const terrace = keyOf(rooms, "Plumbing", 1);
    expect(terrace).toMatch(/@r-terrace$/);
    const priced = applyOwnBasis(rooms, [tap(rooms, 650, { lineKey: terrace })]).boq;
    expect([line(priced, "Plumbing", 0).rate_tier, line(priced, "Plumbing", 1).rate_tier]).toEqual([undefined, OWN_PRICE_TIER]);
    // The terrace's tap removed from scope: the kitchen's is NOT priced in its place.
    const noTerrace: Doc = { ...rooms, sections: rooms.sections.map((x) => (x.work_section === "Plumbing" ? { ...x, lines: x.lines.filter((l) => (l as { room_id?: string }).room_id !== "r-terrace") } : x)) };
    const out = applyOwnBasis(noTerrace, [tap(rooms, 650, { lineKey: terrace })]);
    expect(out.missing).toEqual(["c-tap"]);
    expect(line(out.boq, "Plumbing", 0).rate_tier).toBeUndefined();
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

  it("an unmatched price after a regenerate: Re-apply to a chosen line (next revision), or Remove (stops applying)", async () => {
    const a = await applyCorrection(db.client, "p1", member, { boqId: rev1, rowKey: "Plumbing-0", type: "rate", value: 650, origin: "add_price", basisKind: "supplier_quote" });
    // A regeneration whose scope no longer has the outdoor tap: the assembly records it as unmatched.
    const regen = stage7();
    regen.sections = regen.sections.map((x) => (x.work_section === "Plumbing" ? { ...x, lines: x.lines.slice(1) } : x));
    const laid = applyOwnBasis(rechain(regen as never) as Doc, await loadAppliedCorrections(db.client, "p1"));
    expect(laid.missing).toEqual([a.correctionId]);
    await db.client.from("boqs").insert({ id: "b0000000-0000-4000-8000-000000000003", project_id: "p1", total_aed: laid.boq.grand_total_aed, sections: laid.boq });
    const rev3 = "b0000000-0000-4000-8000-000000000003";
    // Re-apply to the line the member chooses (the drainage point now leads the section).
    await expect(applyCorrection(db.client, "p1", member, { boqId: rev3, correctionId: a.correctionId, rowKey: "Plumbing-0", retarget: true })).resolves.toMatchObject({ rev: 4 });
    const doc4 = latest().sections as Doc;
    expect(line(doc4, "Plumbing", 0)).toMatchObject({ rate_aed: 650, rate_tier: OWN_PRICE_TIER }); // the drainage point, chosen by the member
    expect(doc4.own_basis).toBeUndefined();
    await expect(applyCorrection(db.client, "p1", member, { boqId: latest().id as string, correctionId: a.correctionId, rowKey: "Plumbing-0", retarget: true })).rejects.toMatchObject({ code: "still_matched" });
    // Remove: stops applying, kept on record, no revision.
    const n = db.tables.boqs!.length;
    await releaseCorrection(db.client, "p1", member, a.correctionId);
    expect(db.tables.boqs).toHaveLength(n);
    expect(await loadAppliedCorrections(db.client, "p1")).toEqual([]);
    expect(db.tables.boq_corrections!.find((c) => c.id === a.correctionId)!.reverted_at).toEqual(expect.any(String));
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

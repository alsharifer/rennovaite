import { describe, expect, it } from "vitest";

import { generateDeterministicBoq } from "@/lib/boq/engine";
import { buildGardenSections } from "@/lib/boq/garden-boq-feed";
import { transcriptionGardenBook, transcriptionGardenRows, gardenBookFromRows, withFirmOverlay } from "@/lib/boq/garden-rates";
import { computeGardenTakeoff, priceGardenTakeoff } from "@/lib/boq/garden-takeoff";
import { RateResolver, type AccessoryOverride } from "@/lib/boq/rates";
import { MUDON_FIRST_FLOOR } from "@/lib/boq/fixtures/mudon-first-floor";
import { LABOUR_RATES_FIXTURE } from "@/lib/boq/__tests__/labour-rates.fixture";
import { PRICING_SKUS_FIXTURE } from "@/lib/boq/__tests__/pricing-skus.fixture";
import { PUBLIC_SOURCE_LABEL } from "@/lib/ground-truth/villa94-garden";
import { VILLA94_GARDEN } from "@/lib/ground-truth/villa94-garden-plan";

import { FirmOverlay, FirmRateUnitError, type FirmBook, type FirmRateEntry } from "../firm";
import { applyOhp } from "../ohp";
import type { ReferenceRateRow } from "../reference";
import { FIRM_CORRECTION_LABEL, FIRM_RATE_LABEL, INDICATIVE_LABEL, INTERIOR_REFERENCE_LABEL, RATE_TIERS } from "../tiers";

// L1 — every tier of the resolution order answers, in order, on both paths.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LABOUR = LABOUR_RATES_FIXTURE as any;
const FIRM = "00000000-0000-4000-8000-00000000000a";
const BOOK = "00000000-0000-4000-8000-0000000000b0";

let n = 0;
const entry = (over: Partial<FirmRateEntry>): FirmRateEntry => ({
  id: `e${++n}`,
  firm_id: FIRM,
  book_id: BOOK,
  item_key: "demo.soft_strip",
  grade: null,
  unit: "m2",
  rate_aed: 11,
  kind: "labour",
  origin: "firm_entry",
  correction_id: null,
  ...over,
});
const book = (entries: FirmRateEntry[], ohp_pct = 0): FirmBook => ({ firm_id: FIRM, book_id: BOOK, ohp_pct, entries });
const overlay = (entries: FirmRateEntry[], ohp = 0) => FirmOverlay.forProject(FIRM, book(entries, ohp));
const refRow = (over: Partial<ReferenceRateRow>): ReferenceRateRow => ({
  item_key: "demo.soft_strip",
  grade: "standard",
  unit: "m2",
  rate_aed: 33,
  scope: "install_only",
  provenance: "actual_transaction",
  valid_from: "2026-09-20",
  work_section: "Demolition",
  ...over,
});

const resolver = (opts: { firm?: FirmOverlay; reference?: ReferenceRateRow[]; labour?: unknown[]; accessories?: Record<string, AccessoryOverride> } = {}) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new RateResolver((opts.labour ?? LABOUR) as any, PRICING_SKUS_FIXTURE, "mid", opts.accessories ?? {}, { firm: opts.firm, reference: opts.reference });

describe("interior resolution order (RateResolver)", () => {
  it("4. with no books: catalogue, labour book and allowance answer exactly as before", () => {
    const r = resolver();
    expect(r.resolve("floor.porcelain_material", "m2").rate_tier).toBe("catalog");
    expect(r.resolve("demo.soft_strip", "m2").rate_tier).toBe("labour_book");
    expect(r.resolve("san.shattaf", "no").rate_tier).toBe("allowance");
  });

  it("3. a calibrated reference row beats the rules — under the constant interior label", () => {
    const got = resolver({ reference: [refRow({})] }).resolve("demo.soft_strip", "m2");
    expect(got).toMatchObject({ rate_aed: 33, rate_tier: "reference", vendor_or_source: INTERIOR_REFERENCE_LABEL, rate_band: "book" });
  });

  it("2. a promoted correction beats the reference", () => {
    const got = resolver({
      reference: [refRow({})],
      firm: overlay([entry({ origin: "promoted_correction", rate_aed: 22, correction_id: "c1" })]),
    }).resolve("demo.soft_strip", "m2");
    expect(got).toMatchObject({ rate_aed: 22, rate_tier: "firm_correction", vendor_or_source: FIRM_CORRECTION_LABEL });
  });

  it("1. the firm's own rate beats its promoted correction", () => {
    const got = resolver({
      reference: [refRow({})],
      firm: overlay([entry({ origin: "promoted_correction", rate_aed: 22 }), entry({ rate_aed: 11 })]),
    }).resolve("demo.soft_strip", "m2");
    expect(got).toMatchObject({ rate_aed: 11, rate_tier: "firm_private", vendor_or_source: FIRM_RATE_LABEL });
  });

  it("an exact-grade firm entry beats a grade-less one; grade follows the engine tier", () => {
    const f = overlay([entry({ rate_aed: 11 }), entry({ grade: "standard", rate_aed: 12 }), entry({ grade: "premium", rate_aed: 99 })]);
    expect(resolver({ firm: f }).resolve("demo.soft_strip", "m2").rate_aed).toBe(12); // mid → standard
  });

  it("5. indicative answers only when the rules cannot (and never before them)", () => {
    const ind = refRow({ provenance: "seed", rate_aed: 44 });
    // Rules CAN answer → indicative ignored.
    expect(resolver({ reference: [ind] }).resolve("demo.soft_strip", "m2").rate_tier).toBe("labour_book");
    // No labour row → the rule would throw → indicative answers, labelled as such.
    const got = resolver({ reference: [ind], labour: [] }).resolve("demo.soft_strip", "m2");
    expect(got).toMatchObject({ rate_aed: 44, rate_tier: "indicative", vendor_or_source: INDICATIVE_LABEL });
    // Nothing at all → still throws, never guesses.
    expect(() => resolver({ labour: [] }).resolve("demo.soft_strip", "m2")).toThrow(/labour_rates row not found/);
  });

  it("a firm rate in the wrong unit refuses to price", () => {
    expect(() => resolver({ firm: overlay([entry({ unit: "lm" })]) }).resolve("demo.soft_strip", "m2")).toThrow(FirmRateUnitError);
  });

  it("a user selection lays over whichever tier answered, and says so", () => {
    const chosen: AccessoryOverride = {
      catalog_item_id: "acc1", name: "Mixer X", rate_aed: 900, scope: "supply_only", source: "catalogue", spec_class: "premium", qs_validated: true, default_supply_aed: 600,
    };
    const r = resolver({ firm: overlay([entry({ item_key: "san.basin", unit: "no", rate_aed: 1000, kind: "supply_and_install" })]), accessories: { "san.basin": chosen } });
    const got = r.resolve("san.basin", "no");
    expect(got.rate_tier).toBe("selection");
    expect(got.rate_aed).toBe(1000 + (900 - 600)); // the firm's rate is the base the spec delta moves
    expect(r.resolveDefault("san.basin", "no").rate_tier).toBe("firm_private");
  });

  it("every engine line carries a rate_tier from the vocabulary", () => {
    const { boq } = generateDeterministicBoq({ rooms: MUDON_FIRST_FLOOR, labourRates: LABOUR, skus: PRICING_SKUS_FIXTURE, styleKey: "contemporary-majlis" });
    const tiers = boq.sections.flatMap((s) => s.lines.map((l) => l.rate_tier));
    expect(tiers.every((t) => t && (RATE_TIERS as readonly string[]).includes(t))).toBe(true);
  });

  it("a firm entry moves ONLY its own line; a firm rate on an S6 item reads as priced", () => {
    const base = generateDeterministicBoq({ rooms: MUDON_FIRST_FLOOR, labourRates: LABOUR, skus: PRICING_SKUS_FIXTURE, styleKey: "contemporary-majlis" }).boq;
    const firm = overlay([entry({ rate_aed: 7 })]);
    const withFirm = generateDeterministicBoq({ rooms: MUDON_FIRST_FLOOR, labourRates: LABOUR, skus: PRICING_SKUS_FIXTURE, styleKey: "contemporary-majlis", firm }).boq;
    const lines = (b: typeof base) => b.sections.flatMap((s) => s.lines);
    const changed = lines(withFirm).filter((l, i) => l.rate_aed !== lines(base)[i]!.rate_aed);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ rate_aed: 7, rate_tier: "firm_private", rate_status: "priced", vendor_or_source: FIRM_RATE_LABEL });
  });
});

describe("garden resolution order (rate())", () => {
  const G = (entries: FirmRateEntry[]) => withFirmOverlay(transcriptionGardenBook(), overlay(entries));
  const gEntry = (over: Partial<FirmRateEntry>) => entry({ item_key: "garden.pcc_base", unit: "m2", kind: "labour", ...over });
  const pcc = (b: ReturnType<typeof G>) =>
    priceGardenTakeoff(computeGardenTakeoff(VILLA94_GARDEN, b).items, b).find((l) => l.item_key === "garden.pcc_base")!;

  it("3. no firm → the calibrated reference, under the public market label", () => {
    const l = pcc(transcriptionGardenBook());
    expect(l).toMatchObject({ rate_aed: 105.6, rate_tier: "reference", vendor_or_source: PUBLIC_SOURCE_LABEL });
  });

  it("1 and 2 shadow the reference for this firm only", () => {
    expect(pcc(G([gEntry({ origin: "promoted_correction", rate_aed: 95 })]))).toMatchObject({ rate_aed: 95, rate_tier: "firm_correction", vendor_or_source: FIRM_CORRECTION_LABEL });
    expect(pcc(G([gEntry({ origin: "promoted_correction", rate_aed: 95 }), gEntry({ rate_aed: 90 })]))).toMatchObject({ rate_aed: 90, rate_tier: "firm_private", vendor_or_source: FIRM_RATE_LABEL });
  });

  it("5. an indicative row answers where no calibrated one exists", () => {
    const rows = [...transcriptionGardenRows().filter((r) => r.item_key !== "garden.pcc_base"), { ...transcriptionGardenRows().find((r) => r.item_key === "garden.pcc_base")!, provenance: "indicative" as const, rate_aed: 101 }];
    expect(pcc(gardenBookFromRows(rows))).toMatchObject({ rate_aed: 101, rate_tier: "indicative", vendor_or_source: INDICATIVE_LABEL });
  });

  it("unpriced stays unpriced for the market — but a firm that has a rate prices it", () => {
    const input = { zones: [{ id: "d1", name: "Deck", kind: "deck", area_m2: 10 }] };
    const deckOf = (b: ReturnType<typeof G>) => priceGardenTakeoff(computeGardenTakeoff(input, b).items, b).find((l) => l.item_key === "garden.deck")!;
    expect(deckOf(transcriptionGardenBook())).toMatchObject({ rate_aed: 0, rate_tier: "unpriced", rate_status: "needs_qs" });
    const firmDeck = deckOf(G([entry({ item_key: "garden.deck", unit: "m2", kind: "supply_and_install", rate_aed: 650 })]));
    expect(firmDeck).toMatchObject({ rate_aed: 650, total_aed: 6500, rate_tier: "firm_private" });
    expect(firmDeck.rate_status).toBeUndefined();
  });

  it("the irrigation band multiplies the firm's lump, and the note says whose it is", () => {
    const b = G([entry({ item_key: "garden.irrigation", unit: "lump", kind: "supply_and_install", rate_aed: 10_000 })]);
    const takeoff = computeGardenTakeoff(VILLA94_GARDEN, b);
    const irr = priceGardenTakeoff(takeoff.items, b).find((l) => l.item_key === "garden.irrigation")!;
    expect(irr.rate_tier).toBe("firm_private");
    expect(irr.rate_aed).toBe(Math.round(10_000 * (irr.rate_factor ?? 1) * 100) / 100);
    expect(irr.measurement).toMatch(/contractor's irrigation lump/);
  });

  it("every garden BoQ line carries its tier; the reference build is unchanged by an empty overlay", () => {
    const empty = withFirmOverlay(transcriptionGardenBook(), FirmOverlay.forProject(FIRM, null));
    const a = buildGardenSections(VILLA94_GARDEN, transcriptionGardenBook());
    const b = buildGardenSections(VILLA94_GARDEN, empty);
    expect(JSON.stringify(b.sections)).toBe(JSON.stringify(a.sections));
    for (const l of a.sections.flatMap((s) => s.lines)) expect(l.rate_tier).toBeTruthy();
  });
});

describe("OH&P (L1) — its own line, never in a rate", () => {
  const priced = () => generateDeterministicBoq({ rooms: MUDON_FIRST_FLOOR, labourRates: LABOUR, skus: PRICING_SKUS_FIXTURE, styleKey: null }).boq;

  it("0% (or no firm) leaves the document byte-identical — no field is added", () => {
    const a = priced();
    const b = applyOhp(priced(), 0);
    b.engine.generated_at = a.engine.generated_at;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect("ohp_aed" in b).toBe(false);
  });

  it("a firm's OH&P is one line over the subtotal, carried through contingency and VAT", () => {
    const base = priced();
    const withOhp = applyOhp(priced(), 12);
    expect(withOhp.ohp_pct).toBe(12);
    expect(withOhp.ohp_aed).toBe(Math.round(base.subtotal_aed * 0.12));
    expect(withOhp.subtotal_aed).toBe(base.subtotal_aed);
    expect(withOhp.contingency_aed).toBe(Math.round(((base.subtotal_aed + withOhp.ohp_aed!) * base.contingency_pct) / 100));
    expect(withOhp.grand_total_aed).toBe(withOhp.subtotal_aed + withOhp.ohp_aed! + withOhp.contingency_aed + withOhp.vat_aed);
    // Never baked into a rate: every line is untouched.
    expect(JSON.stringify(withOhp.sections)).toBe(JSON.stringify(base.sections));
  });

  it("the firm overlay carries the book's OH&P; no firm carries none", () => {
    expect(overlay([], 10).ohpPct).toBe(10);
    expect(FirmOverlay.none().ohpPct).toBe(0);
  });
});

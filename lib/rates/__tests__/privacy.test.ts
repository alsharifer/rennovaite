import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { generateDeterministicBoq } from "@/lib/boq/engine";
import { buildGardenSections } from "@/lib/boq/garden-boq-feed";
import { gardenBookFromRows, transcriptionGardenRows, withFirmOverlay } from "@/lib/boq/garden-rates";
import { MUDON_FIRST_FLOOR } from "@/lib/boq/fixtures/mudon-first-floor";
import { LABOUR_RATES_FIXTURE } from "@/lib/boq/__tests__/labour-rates.fixture";
import { PRICING_SKUS_FIXTURE } from "@/lib/boq/__tests__/pricing-skus.fixture";
import { INTERNAL_REF } from "@/lib/ground-truth/villa94-garden";
import { VILLA94_GARDEN } from "@/lib/ground-truth/villa94-garden-plan";
import { fakeDb } from "@/lib/firms/__tests__/fake-db";

import { FirmIsolationError, FirmOverlay, loadFirmBook, loadProjectFirmOverlay, type FirmBook } from "../firm";
import { loadReferenceRows, type ReferenceRateRow } from "../reference";

// =============================================================================
// L1 privacy assertions.
//
//   1. Firm A never resolves, displays or exports firm B's rates.
//   2. The reference book is never written by a pricing or overlay path
//      (the store half of this — every CRUD op — is in lib/firms/__tests__).
//   3. No supplier / contractor name from rate_book.source (or internal_ref)
//      reaches any resolved-figure payload. Sanitised at the RESOLVER boundary:
//      the loader never selects those columns, copies only whitelisted fields,
//      and every label a resolver emits is a code constant.
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LABOUR = LABOUR_RATES_FIXTURE as any;
const A = "00000000-0000-4000-8000-0000000000aa";
const B = "00000000-0000-4000-8000-0000000000bb";
const BOOK_A = "00000000-0000-4000-8000-00000000a0a0";
const BOOK_B = "00000000-0000-4000-8000-00000000b0b0";

const firmsSeed = {
  firms: [
    { id: A, name: "Alpha Landscapes LLC", private: true },
    { id: B, name: "Beta Fitout Contracting", private: true },
  ],
  firm_rate_books: [
    { id: BOOK_A, firm_id: A, ohp_pct: 8 },
    { id: BOOK_B, firm_id: B, ohp_pct: 15 },
  ],
  firm_rate_entries: [
    { id: "ea1", firm_id: A, book_id: BOOK_A, item_key: "demo.soft_strip", grade: null, unit: "m2", rate_aed: 11.11, kind: "labour", origin: "firm_entry", correction_id: null },
    { id: "ea2", firm_id: A, book_id: BOOK_A, item_key: "garden.pcc_base", grade: null, unit: "m2", rate_aed: 91.11, kind: "labour", origin: "firm_entry", correction_id: null },
    { id: "eb1", firm_id: B, book_id: BOOK_B, item_key: "demo.soft_strip", grade: null, unit: "m2", rate_aed: 77.77, kind: "labour", origin: "firm_entry", correction_id: null },
    { id: "eb2", firm_id: B, book_id: BOOK_B, item_key: "garden.pcc_base", grade: null, unit: "m2", rate_aed: 177.77, kind: "labour", origin: "firm_entry", correction_id: null },
  ],
  projects: [
    { id: "pa", firm_id: A },
    { id: "pb", firm_id: B },
    { id: "p0", firm_id: null },
  ],
};

const interior = (firm: FirmOverlay, reference?: ReferenceRateRow[]) =>
  generateDeterministicBoq({ rooms: MUDON_FIRST_FLOOR, labourRates: LABOUR, skus: PRICING_SKUS_FIXTURE, styleKey: "contemporary-majlis", firm, referenceRows: reference }).boq;
const garden = (firm: FirmOverlay) =>
  buildGardenSections(VILLA94_GARDEN, withFirmOverlay(gardenBookFromRows(transcriptionGardenRows()), firm));

describe("firm A never resolves, displays or exports firm B's rates", () => {
  it("each project resolves ITS firm's book — and a firm-less project the reference", async () => {
    const db = fakeDb(firmsSeed);
    const oa = await loadProjectFirmOverlay(db.client, "pa");
    const ob = await loadProjectFirmOverlay(db.client, "pb");
    const o0 = await loadProjectFirmOverlay(db.client, "p0");
    expect([oa.firmId, ob.firmId, o0.firmId]).toEqual([A, B, null]);
    expect([oa.ohpPct, ob.ohpPct, o0.ohpPct]).toEqual([8, 15, 0]);

    const docA = JSON.stringify({ i: interior(oa), g: garden(oa).sections });
    const docB = JSON.stringify({ i: interior(ob), g: garden(ob).sections });
    const doc0 = JSON.stringify({ i: interior(o0), g: garden(o0).sections });
    // A's document carries A's rates and none of B's; and vice versa.
    expect(docA).toContain("11.11");
    expect(docA).toContain("91.11");
    for (const bRate of ["77.77", "177.77"]) expect(docA).not.toContain(bRate);
    expect(docB).toContain("77.77");
    for (const aRate of ["11.11", "91.11"]) expect(docB).not.toContain(aRate);
    for (const any of ["11.11", "91.11", "77.77", "177.77"]) expect(doc0).not.toContain(any);
    // A firm's NAME is on no line of any document — its own included.
    for (const doc of [docA, docB, doc0]) {
      expect(doc).not.toContain("Alpha Landscapes");
      expect(doc).not.toContain("Beta Fitout");
    }
  });

  it("the loader scopes both reads by firm id", async () => {
    const db = fakeDb(firmsSeed);
    const book = (await loadFirmBook(db.client, A))!;
    expect(book.entries.map((e) => e.id).sort()).toEqual(["ea1", "ea2"]);
    expect(book.entries.every((e) => e.firm_id === A)).toBe(true);
  });

  it("defence in depth: even a query that leaked B's rows cannot build A's overlay", async () => {
    const db = fakeDb(firmsSeed);
    db.ignoreFilters.add("firm_rate_entries"); // simulate a broken upstream query
    await expect(loadProjectFirmOverlay(db.client, "pa")).rejects.toThrow(FirmIsolationError);
  });

  it("the overlay refuses another firm's book, a foreign entry, or a book on a firm-less project", () => {
    const bookB: FirmBook = { firm_id: B, book_id: BOOK_B, ohp_pct: 0, entries: [] };
    expect(() => FirmOverlay.forProject(A, bookB)).toThrow(FirmIsolationError);
    const smuggled: FirmBook = {
      firm_id: A, book_id: BOOK_A, ohp_pct: 0,
      entries: [{ id: "x", firm_id: B, book_id: BOOK_B, item_key: "demo.soft_strip", grade: null, unit: "m2", rate_aed: 1, kind: "labour", origin: "firm_entry", correction_id: null }],
    };
    expect(() => FirmOverlay.forProject(A, smuggled)).toThrow(FirmIsolationError);
    expect(() => FirmOverlay.forProject(null, bookB)).toThrow(FirmIsolationError);
  });
});

describe("no rate_book.source / internal_ref reaches a resolved figure", () => {
  // The real strings the Mudon interior actuals and the garden seed carry.
  const NAMES = ["RAK cart", "Atrium", "QTN20261407", "Global Creation", "Laspinas", "SOW AlNaseem", "KAME", INTERNAL_REF];

  const leaky = (r: ReferenceRateRow): ReferenceRateRow =>
    ({ ...r, source: `Atrium QTN20261407 · RAK cart 0000160602 · Laspinas quotation 46703`, internal_ref: INTERNAL_REF }) as ReferenceRateRow;

  it("the loader never selects them, and strips them if a row carries them anyway", async () => {
    const db = fakeDb({
      rate_book: [
        { city: "Dubai", item_key: "demo.soft_strip", grade: "standard", unit: "m2", rate_aed: 33, scope: "install_only", provenance: "actual_transaction", valid_from: "2026-09-20", work_section: "Demolition", source: "Global Creation ref 3936/R1", internal_ref: INTERNAL_REF },
      ],
    });
    const rows = await loadReferenceRows(db.client);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(["grade", "item_key", "provenance", "rate_aed", "scope", "unit", "valid_from", "work_section"]);
    expect(JSON.stringify(rows)).not.toContain("Global Creation");
  });

  it("interior + garden BoQs priced from rows that CARRY source/internal_ref contain neither", () => {
    // Canary strings: unique, so a hit can only have come through a rate_book row.
    // (Real supplier names are NOT usable here: "Laspinas" and "RAK Ceramics"
    // already reach the Mudon BoQ through RATE_RULES allowance notes and
    // pricing_skus.vendor — a separate, pre-existing path, see the L1 report.)
    const CANARY_SOURCE = "CANARY-SOURCE-3f9a Atrium QTN20261407";
    const CANARY_REF = `CANARY-REF-81c2 ${INTERNAL_REF}`;
    const canary = (r: ReferenceRateRow) => ({ ...r, source: CANARY_SOURCE, internal_ref: CANARY_REF }) as ReferenceRateRow;
    const interiorRow: ReferenceRateRow = { item_key: "demo.soft_strip", unit: "m2", grade: "standard", rate_aed: 33, scope: "install_only", provenance: "actual_transaction", valid_from: "2026-09-20", work_section: "Demolition" };
    const build = (wrap: (r: ReferenceRateRow) => ReferenceRateRow) => {
      const i = interior(FirmOverlay.none(), [wrap(interiorRow)]);
      i.engine.generated_at = "fixed";
      return JSON.stringify({ interior: i, garden: buildGardenSections(VILLA94_GARDEN, gardenBookFromRows(transcriptionGardenRows().map(wrap))).sections });
    };
    const leakyDoc = build(canary);
    expect(leakyDoc).toContain('"rate_tier":"reference"'); // the canary rows DID price
    for (const s of ["CANARY-SOURCE", "CANARY-REF", "QTN20261407", INTERNAL_REF]) expect(leakyDoc, s).not.toContain(s);
    // And the extra columns change NOTHING: byte-identical to the same rows without them.
    expect(leakyDoc).toBe(build((r) => r));
  });

  it("the Mudon interior seed's real source strings are carried by no resolved line", () => {
    const i = interior(FirmOverlay.none(), [
      leaky({ item_key: "demo.soft_strip", unit: "m2", grade: "standard", rate_aed: 33, scope: "install_only", provenance: "actual_transaction", valid_from: "2026-09-20", work_section: "Demolition" }),
    ]);
    const line = i.sections.flatMap((s) => s.lines).find((l) => l.rate_tier === "reference")!;
    for (const name of NAMES) expect(JSON.stringify(line), name).not.toContain(name);
  });
});

describe("the reference book is never written by an app or lib path", () => {
  const ROOT = path.resolve(__dirname, "../../..");
  const WRITE = /from\(\s*["'`]rate_book["'`]\s*\)[\s\S]{0,240}?\.(insert|update|upsert|delete)\s*\(/;

  function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "__tests__" || e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
    return out;
  }

  it("no file under app/ or lib/ inserts, updates, upserts or deletes rate_book rows", () => {
    const offenders = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "lib"))].filter((f) => WRITE.test(fs.readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});

import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type { Caller } from "@/lib/auth/caller";
import { lineTotal } from "@/lib/boq/money";
import { fakeDb, type FakeDb } from "@/lib/firms/__tests__/fake-db";
import { StoreError, assignProjectFirm, createFirm } from "@/lib/firms/store";
import { loadProjectFirmOverlay } from "@/lib/rates/firm";

import { acceptQuote, importQuote, reviewQuote, updateQuoteLine } from "../store";

// =============================================================================
// H8 — the J0 synthetic-quote finding, on the fake db.
//   Row 5 "Aluminium louvred pergola 3.5 x 3.5 m", 1 no at 24,500, matched to
//   garden.pergola (per m² plan, reference 1,366.69). Before H8 it was ACCEPTED
//   at 24,500 / m² plan — 17.9× — and would have priced Arabella's pergola at
//   12.25 × 24,500 = 300,125.00 instead of 16,741.95.
//   Now: HELD "rate is 17.9× the reference — check the unit", the conversion
//   24,500 ÷ 12.25 = 2,000.00 / m² plan OFFERED; an outlier kept as quoted is
//   an explicit confirm, recorded as an event.
// =============================================================================

const alice: Caller = { id: "00000000-0000-4000-8000-00000000a11c", email: "alice@firm-a.test" };
const FIXTURE = new Uint8Array(fs.readFileSync(path.resolve(__dirname, "../__fixtures__/synthetic-quote.xlsx")));
const META = { supplier_label: "Example Supplier (synthetic)", supplier_role: "supplier" as const, quote_ref: "JS-SAMPLE-001", currency: "AED", vat_treatment: "excl" as const, rates_are: "net" as const, discount_pct: 0 };
const ref = (id: string, item_key: string, unit: string, rate_aed: number) => ({ id, city: "Dubai", item_key, grade: "standard", unit, rate_aed, scope: "supply_and_install", provenance: "actual_transaction", valid_from: "2026-09-12", work_section: "External Works" });

let db: FakeDb;
let A: { id: string };
beforeEach(async () => {
  db = fakeDb({
    rate_book: [ref("r1", "garden.pcc_base", "m2", 105.6), ref("r2", "garden.pergola", "m2 plan", 1366.6928), ref("r3", "garden.grass_supply", "m2", 26.4)],
    projects: [{ id: "p1", firm_id: null, created_by: alice.id }],
    boq_corrections: [],
    firm_members: [],
    firm_quotes: [],
    firm_quote_lines: [],
    pilot_events: [],
  });
  A = await createFirm(db.client, { name: "Firm A" }, alice);
});

async function imported() {
  const { quote, lines } = await importQuote(db.client, A.id, alice, META, { name: "synthetic-quote.xlsx", bytes: FIXTURE });
  const row = (re: RegExp) => lines.find((l) => re.test(l.description))!;
  const pergola = row(/pergola/i);
  const grass = row(/grass/i);
  const pcc = row(/PCC/);
  await updateQuoteLine(db.client, A.id, quote.id, pergola.id, { item_key: "garden.pergola" }, alice);
  await updateQuoteLine(db.client, A.id, quote.id, grass.id, { item_key: "garden.grass_supply" }, alice);
  await updateQuoteLine(db.client, A.id, quote.id, pcc.id, { item_key: "garden.pcc_base" }, alice);
  const review = async () => {
    const r = await reviewQuote(db.client, A.id, quote.id, alice);
    return { pergola: r.lines.find((l) => l.id === pergola.id)!, grass: r.lines.find((l) => l.id === grass.id)!, pcc: r.lines.find((l) => l.id === pcc.id)! };
  };
  return { quote, ids: { pergola: pergola.id, grass: grass.id, pcc: pcc.id }, review };
}

describe("H8 — the magnitude hold at review", () => {
  it("holds the pergola at 17.9× and offers 24,500 ÷ 12.25 = 2,000.00 / m² plan", async () => {
    const { review } = await imported();
    const { pergola, pcc } = await review();
    expect(pergola).toMatchObject({ status: "unmatched", hold_reason: "rate is 17.9× the reference — check the unit", magnitude_ratio: 17.93, reference_rate_aed: 1366.69, unit: "m2 plan", unit_given: "no" });
    expect(pergola.conversion).toMatchObject({ rate_aed: 2000, quantity: 12.25, unit: "m2 plan", ratio: 1.46 });
    expect(pcc).toMatchObject({ status: "matched", hold_reason: null, magnitude_ratio: 0.93 });
  });

  it("the grass line at 3.1× is held too — the rule, not the pergola, decides", async () => {
    const { grass } = await (await imported()).review();
    expect(grass).toMatchObject({ status: "unmatched", hold_reason: "rate is 3.1× the reference — check the unit" });
    expect(grass.conversion).toBeNull(); // "per m2" already: nothing to convert
  });

  it("applying the offer converts rate, quantity and unit, and the line passes", async () => {
    const { quote, ids, review } = await imported();
    const line = await updateQuoteLine(db.client, A.id, quote.id, ids.pergola, { apply_conversion: true }, alice);
    // The quoted line keeps its 1 no; only the book's rate and unit are converted.
    expect(line).toMatchObject({ status: "matched", rate_aed: 2000, qty: 1, unit: "m2 plan", unit_given: "no", hold_reason: null });
    expect(line.conversion_note).toContain("÷ 12.25");
    expect((await review()).pergola.conversion).toBeNull();
  });

  it("keeping an outlier as quoted is an explicit confirm, recorded as an event", async () => {
    const { quote, ids } = await imported();
    await expect(updateQuoteLine(db.client, A.id, quote.id, ids.pcc, { confirm_outlier: true }, alice)).rejects.toMatchObject({ status: 409, code: "not_an_outlier" });
    const line = await updateQuoteLine(db.client, A.id, quote.id, ids.grass, { confirm_outlier: true }, alice);
    expect(line).toMatchObject({ status: "matched", outlier_confirmed_by: alice.id });
    const ev = db.tables.pilot_events!.find((e) => (e.detail as { action?: string })?.action === "outlier_confirmed");
    expect(ev).toMatchObject({ kind: "rate_book_change", firm_id: A.id, actor: alice.id });
    expect(ev!.detail).toMatchObject({ item_key: "garden.grass_supply", rate_aed: 82, ratio: 3.11 });
  });

  it("accept: the converted pergola prices 12.25 × 2,000 = 24,500.00, never 300,125.00", async () => {
    const { quote, ids } = await imported();
    // Unconverted and unconfirmed, the pergola is held at accept — it never enters the book.
    await updateQuoteLine(db.client, A.id, quote.id, ids.grass, { status: "rejected" }, alice);
    const r0 = await reviewQuote(db.client, A.id, quote.id, alice);
    expect(r0.lines.find((l) => l.id === ids.pergola)!.status).toBe("unmatched");
    await updateQuoteLine(db.client, A.id, quote.id, ids.pergola, { apply_conversion: true }, alice);
    const res = await acceptQuote(db.client, A.id, quote.id, alice);
    expect(res.entries.find((e) => e.item_key === "garden.pergola")).toMatchObject({ rate_aed: 2000, unit: "m2 plan" });
    await assignProjectFirm(db.client, "p1", A.id, alice);
    const hit = (await loadProjectFirmOverlay(db.client, "p1")).lookup("garden.pergola", "standard", "m2 plan");
    expect(lineTotal(12.25, hit!.entry.rate_aed)).toBe(24500);
    expect(lineTotal(12.25, 24500)).toBe(300125); // what the unchecked import would have priced
  });

  it("an outlier left unconfirmed never enters the book", async () => {
    const { quote } = await imported();
    const res = await acceptQuote(db.client, A.id, quote.id, alice);
    expect(res.entries.map((e) => e.item_key)).not.toContain("garden.pergola");
    expect(res.entries.map((e) => e.item_key)).not.toContain("garden.grass_supply");
    expect(res.held).toBeGreaterThanOrEqual(2);
    void StoreError;
  });
});

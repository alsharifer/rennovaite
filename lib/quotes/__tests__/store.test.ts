import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type { Caller } from "@/lib/auth/caller";
import { generateDeterministicBoq } from "@/lib/boq/engine";
import { LABOUR_RATES_FIXTURE } from "@/lib/boq/__tests__/labour-rates.fixture";
import { PRICING_SKUS_FIXTURE } from "@/lib/boq/__tests__/pricing-skus.fixture";
import { MUDON_FIRST_FLOOR } from "@/lib/boq/fixtures/mudon-first-floor";
import { fakeDb, type FakeDb } from "@/lib/firms/__tests__/fake-db";
import { StoreError, assignProjectFirm, createEntry, createFirm, getFirmSummary, listEntries, updateFirm } from "@/lib/firms/store";
import { FIRM_QUOTE_LABEL } from "@/lib/rates/tiers";
import { loadProjectFirmOverlay } from "@/lib/rates/firm";

import { acceptQuote, confirmSuggestions, getQuote, importQuote, listQuotes, updateQuoteLine } from "../store";

// =============================================================================
// U3 — template → import → review → accept, on the fake db:
//   - nothing is confirmed by the machine; held lines stay visible;
//   - accept creates quote_import entries traced to the quote, touches nothing
//     of another origin, and never deletes;
//   - a re-import is a new version whose accept supersedes the earlier entries
//     (history kept); the overlay prices the newest;
//   - the supplier's label reaches no BoQ line;
//   - another firm's member is refused.
// =============================================================================

const alice: Caller = { id: "00000000-0000-4000-8000-00000000a11c", email: "alice@firm-a.test" };
const bob: Caller = { id: "00000000-0000-4000-8000-000000000b0b", email: "bob@firm-b.test" };
const FIXTURE = new Uint8Array(fs.readFileSync(path.resolve(__dirname, "../__fixtures__/synthetic-quote.xlsx")));
const META = { supplier_label: "Acme Tiles & Stone LLC", supplier_role: "supplier" as const, quote_ref: "Q-2026-0917", currency: "AED", vat_treatment: "excl" as const, rates_are: "net" as const, discount_pct: 0 };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LABOUR = LABOUR_RATES_FIXTURE as any;

let db: FakeDb;
let A: { id: string };
let snapshot: string;
async function expectStoreError(p: Promise<unknown>, status: number, code?: string) {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(StoreError);
  expect((err as StoreError).status).toBe(status);
  if (code) expect((err as StoreError).code).toBe(code);
}

beforeEach(async () => {
  db = fakeDb({ rate_book: [{ id: "r1", city: "Dubai", item_key: "garden.pcc_base", grade: "standard", unit: "m2", rate_aed: 105.6, scope: "install_only", provenance: "actual_transaction", valid_from: "2026-09-12", work_section: "External Works" }], projects: [{ id: "p1", firm_id: null }], boq_corrections: [], firm_members: [], firm_quotes: [], firm_quote_lines: [] });
  A = await createFirm(db.client, { name: "Firm A" }, alice);
  snapshot = JSON.stringify(db.tables.rate_book);
});

describe("import", () => {
  it("creates a quote in review with one line per row, suggestions only, held reasons visible", async () => {
    const { quote, lines, summary } = await importQuote(db.client, A.id, alice, META, { name: "synthetic-quote.xlsx", bytes: FIXTURE });
    expect(quote).toMatchObject({ status: "review", version: 1, supersedes_quote_id: null, supplier_label: META.supplier_label, quote_ref: "Q-2026-0917" });
    expect(quote.source_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(lines).toHaveLength(8);
    expect(lines.every((l) => l.item_key === null && l.status === "unmatched")).toBe(true); // never auto-merged
    expect(lines[0]).toMatchObject({ suggested_item_key: "garden.pcc_base", suggestion_score: 1, rate_aed: 98.5, hold_reason: null });
    expect(lines.find((l) => l.currency === "USD")!.hold_reason).toMatch(/currency USD/);
    expect(lines.find((l) => l.rate_raw === null)!.hold_reason).toMatch(/not a number/);
    expect(lines.find((l) => /sign board/.test(l.description))!.hold_reason).toMatch(/no matching item/);
    expect(summary).toMatchObject({ lines: 8, version: 1 });
    expect(summary.suggested).toBeGreaterThanOrEqual(4);
    expect(db.tables.firm_rate_entries ?? []).toHaveLength(0); // nothing entered the book
    expect(JSON.stringify(db.tables.rate_book)).toBe(snapshot);
  });

  it("refuses an unreadable or empty workbook, and an unnamed supplier", async () => {
    await expectStoreError(importQuote(db.client, A.id, alice, META, { name: "x.xlsx", bytes: new Uint8Array([1, 2, 3]) }), 422, "unreadable_quote");
    await expectStoreError(importQuote(db.client, A.id, alice, { ...META, supplier_label: " " }, { name: "x.xlsx", bytes: FIXTURE }), 422, "supplier_required");
  });

  it("is members-only: bob gets 403, nobody gets 401; the record is invisible to bob", async () => {
    await expectStoreError(importQuote(db.client, A.id, bob, META, { name: "x.xlsx", bytes: FIXTURE }), 403, "not_a_member");
    await expectStoreError(importQuote(db.client, A.id, null, META, { name: "x.xlsx", bytes: FIXTURE }), 401, "unauthenticated");
    const { quote } = await importQuote(db.client, A.id, alice, META, { name: "x.xlsx", bytes: FIXTURE });
    await expectStoreError(getQuote(db.client, A.id, quote.id, bob), 403, "not_a_member");
    await expectStoreError(listQuotes(db.client, A.id, bob), 403, "not_a_member");
    await expectStoreError(acceptQuote(db.client, A.id, quote.id, bob), 403, "not_a_member");
    // And through bob's OWN firm's path the quote id is simply not found.
    const B = await createFirm(db.client, { name: "Firm B" }, bob);
    await expectStoreError(getQuote(db.client, B.id, quote.id, bob), 404, "quote_not_found");
  });
});

describe("review → accept", () => {
  it("confirm → matched (validated), reject, accept: rates land with quote provenance; held lines stay held", async () => {
    const { quote, lines } = await importQuote(db.client, A.id, alice, META, { name: "q.xlsx", bytes: FIXTURE });
    const pcc = lines.find((l) => l.item_key_given === "garden.pcc_base")!;
    const plaster = lines.find((l) => /plaster/i.test(l.description))!;
    const sign = lines.find((l) => /sign board/.test(l.description))!;

    const m = await updateQuoteLine(db.client, A.id, quote.id, pcc.id, { item_key: "garden.pcc_base" }, alice);
    expect(m).toMatchObject({ status: "matched", item_key: "garden.pcc_base", unit: "m2", kind: "labour", hold_reason: null });
    // A wrong kind keeps the line held with the book's own reason.
    const bad = await updateQuoteLine(db.client, A.id, quote.id, pcc.id, { kind: "supply_and_install" }, alice);
    expect(bad.status).toBe("unmatched");
    expect(bad.hold_reason).toMatch(/takes a labour \/ lump rate/);
    await updateQuoteLine(db.client, A.id, quote.id, pcc.id, { kind: "labour" }, alice);
    await updateQuoteLine(db.client, A.id, quote.id, plaster.id, { item_key: "wall_plaster" }, alice);
    const rejected = await updateQuoteLine(db.client, A.id, quote.id, sign.id, { status: "rejected" }, alice);
    expect(rejected.status).toBe("rejected");
    await expectStoreError(updateQuoteLine(db.client, A.id, quote.id, pcc.id, { item_key: "not.a.key" }, alice), 422, "invalid_entry");

    const r = await acceptQuote(db.client, A.id, quote.id, alice);
    expect(r).toMatchObject({ accepted: 2, rejected: 1, superseded: 0 });
    expect(r.held).toBe(8 - 2 - 1);
    const entries = await listEntries(db.client, A.id, alice);
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.origin).toBe("quote_import");
      expect(e.quote_id).toBe(quote.id);
    }
    expect(entries.find((e) => e.item_key === "garden.pcc_base")).toMatchObject({ rate_aed: 98.5, unit: "m2", kind: "labour" });
    const after = await getQuote(db.client, A.id, quote.id, alice);
    expect(after.quote.status).toBe("accepted");
    expect(after.lines.filter((l) => l.status === "accepted").map((l) => l.entry_id).every(Boolean)).toBe(true);
    expect(after.lines.filter((l) => l.status === "unmatched")).toHaveLength(5); // still on the record, with reasons
    expect(after.lines.filter((l) => l.status === "unmatched").every((l) => l.hold_reason)).toBe(true);
    // The book is back to draft (content changed) and the reference book never moved.
    expect((await getFirmSummary(db.client, A.id, alice)).status).toBe("draft");
    expect(JSON.stringify(db.tables.rate_book)).toBe(snapshot);
    // Accepting again is refused; the closed quote's lines are read-only.
    await expectStoreError(acceptQuote(db.client, A.id, quote.id, alice), 409, "already_accepted");
    await expectStoreError(updateQuoteLine(db.client, A.id, quote.id, pcc.id, { grade: "premium" }, alice), 409, "quote_closed");
  });

  it("confirmSuggestions confirms only what scores enough, in one explicit act", async () => {
    const { quote } = await importQuote(db.client, A.id, alice, META, { name: "q.xlsx", bytes: FIXTURE });
    const { confirmed } = await confirmSuggestions(db.client, A.id, quote.id, alice, 0.5);
    expect(confirmed).toBeGreaterThanOrEqual(3);
    const { lines } = await getQuote(db.client, A.id, quote.id, alice);
    for (const l of lines) if (l.item_key) expect(l.suggestion_score ?? 0).toBeGreaterThanOrEqual(0.5);
    expect(lines.find((l) => /sign board/.test(l.description))!.item_key).toBeNull();
  });

  it("accept touches no entry of another origin, and the overlay prefers a typed rate over an imported one", async () => {
    const typed = await createEntry(db.client, A.id, { item_key: "garden.pcc_base", unit: "m2", rate_aed: 77, kind: "labour" }, alice);
    await updateFirm(db.client, A.id, { status: "reviewed" }, alice);
    const { quote, lines } = await importQuote(db.client, A.id, alice, META, { name: "q.xlsx", bytes: FIXTURE });
    await updateQuoteLine(db.client, A.id, quote.id, lines[0]!.id, { item_key: "garden.pcc_base" }, alice);
    await acceptQuote(db.client, A.id, quote.id, alice);
    const all = db.tables.firm_rate_entries!;
    expect(all.find((e) => e.id === typed.id)).toMatchObject({ rate_aed: 77, superseded_at: null });
    await assignProjectFirm(db.client, "p1", A.id, alice);
    const hit = (await loadProjectFirmOverlay(db.client, "p1")).lookup("garden.pcc_base", "standard", "m2");
    expect(hit).toMatchObject({ tier: "firm_private", entry: { origin: "firm_entry", rate_aed: 77 } });
  });
});

describe("re-import (idempotence with history)", () => {
  it("the same reference again is version 2; accepting it supersedes v1's entries, keeps them, and the overlay prices v2", async () => {
    const v1 = await importQuote(db.client, A.id, alice, META, { name: "q.xlsx", bytes: FIXTURE });
    await confirmSuggestions(db.client, A.id, v1.quote.id, alice, 0.5);
    const r1 = await acceptQuote(db.client, A.id, v1.quote.id, alice);
    expect(r1.accepted).toBeGreaterThanOrEqual(3);
    const activeBefore = (await listEntries(db.client, A.id, alice)).length;

    const v2 = await importQuote(db.client, A.id, alice, { ...META, rates_are: "list", discount_pct: 10 }, { name: "q-revised.xlsx", bytes: FIXTURE });
    expect(v2.quote).toMatchObject({ version: 2, supersedes_quote_id: v1.quote.id, status: "review" });
    await confirmSuggestions(db.client, A.id, v2.quote.id, alice, 0.5);
    const r2 = await acceptQuote(db.client, A.id, v2.quote.id, alice);
    expect(r2.accepted).toBe(r1.accepted);
    expect(r2.superseded).toBe(r1.accepted);

    const all = db.tables.firm_rate_entries!;
    expect(all.filter((e) => e.quote_id === v1.quote.id).every((e) => e.superseded_at && e.superseded_by)).toBe(true); // history kept
    expect(all.filter((e) => e.quote_id === v2.quote.id).every((e) => !e.superseded_at)).toBe(true);
    expect((await listEntries(db.client, A.id, alice)).length).toBe(activeBefore); // active count unchanged — updated, not doubled
    expect((await getQuote(db.client, A.id, v1.quote.id, alice)).quote.status).toBe("superseded");
    await assignProjectFirm(db.client, "p1", A.id, alice);
    const hit = (await loadProjectFirmOverlay(db.client, "p1")).lookup("garden.pcc_base", "standard", "m2");
    expect(hit?.entry.rate_aed).toBe(88.65); // 98.5 − 10%
    expect(hit?.entry.quote_id).toBe(v2.quote.id);
  });
});

describe("leak", () => {
  it("a BoQ priced through a quote-import entry carries the constant label and never the supplier's", async () => {
    const { quote, lines } = await importQuote(db.client, A.id, alice, META, { name: "q.xlsx", bytes: FIXTURE });
    await updateQuoteLine(db.client, A.id, quote.id, lines.find((l) => /plaster/i.test(l.description))!.id, { item_key: "wall_plaster" }, alice);
    await updateQuoteLine(db.client, A.id, quote.id, lines[1]!.id, { item_key: "floor.porcelain_material" }, alice);
    await acceptQuote(db.client, A.id, quote.id, alice);
    await assignProjectFirm(db.client, "p1", A.id, alice);
    const firm = await loadProjectFirmOverlay(db.client, "p1");
    const boq = generateDeterministicBoq({ rooms: MUDON_FIRST_FLOOR, labourRates: LABOUR, skus: PRICING_SKUS_FIXTURE, styleKey: "contemporary-majlis", firm }).boq;
    const doc = JSON.stringify(boq);
    expect(doc).toContain(FIRM_QUOTE_LABEL);
    expect(doc).not.toContain("Acme");
    expect(doc).not.toContain("Q-2026-0917");
  });
});

describe("the store never deletes a rate entry", () => {
  it("no .delete() on firm_rate_entries in lib/quotes", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../store.ts"), "utf8");
    expect(src).not.toMatch(/from\("firm_rate_entries"\)[\s\S]{0,200}?\.delete\(/);
    expect(src).not.toMatch(/\.delete\(\)/);
  });
});

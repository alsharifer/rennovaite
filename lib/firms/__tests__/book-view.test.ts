import { describe, expect, it } from "vitest";

import type { Caller } from "@/lib/auth/caller";

import { loadBookAttention, reviewBlockText, vsRef } from "../book-view";
import { StoreError, updateFirm } from "../store";
import { fakeDb } from "./fake-db";

// =============================================================================
// K4 — Rates & Basis (R7 §3.3): what stops "Mark book reviewed", and the vs-ref
// column. An unconfirmed outlier (H8) blocks the review — on the screen AND at
// the route (409 attention_open) — and its recorded confirmation unblocks it.
// =============================================================================

const alice: Caller = { id: "aaaaaaaa-0000-4000-8000-000000000001", email: "a@test.local" };
const FIRM = "ffffffff-0000-4000-8000-000000000001";

function seed(rate: number, extra: Record<string, unknown[]> = {}) {
  return fakeDb({
    firms: [{ id: FIRM, name: "Test firm" }],
    firm_members: [{ firm_id: FIRM, user_id: alice.id }],
    firm_rate_books: [{ id: "book-1", firm_id: FIRM, ohp_pct: 0, status: "draft" }],
    // wall_plaster shadows the built-in element rate (55.00 / m2).
    firm_rate_entries: [{ id: "e-1", firm_id: FIRM, book_id: "book-1", item_key: "wall_plaster", grade: null, unit: "m2", rate_aed: rate, kind: "supply_and_install", origin: "firm_entry" }],
    pilot_events: [],
    firm_quote_lines: [],
    ...extra,
  });
}

describe("vsRef / reviewBlockText", () => {
  it("prints a percentage inside the band and a ratio outside it", () => {
    expect(vsRef(97, 105.6)).toBe("−8.1%");
    expect(vsRef(145, 128.1)).toBe("+13.2%");
    expect(vsRef(24500, 1366.69)).toBe("×17.9");
    expect(vsRef(10, null)).toBe("—");
  });
  it("names what is open, or nothing", () => {
    expect(reviewBlockText(2, 2)).toBe("Resolve 2 conflicts and confirm 2 outliers first");
    expect(reviewBlockText(0, 1)).toBe("Confirm 1 outlier first");
    expect(reviewBlockText(0, 0)).toBeNull();
  });
});

describe("the review gate", () => {
  it("an unconfirmed outlier is open attention, and the route refuses the review", async () => {
    const db = seed(200);
    expect(await loadBookAttention(db.client, FIRM)).toEqual({ conflicts: 0, outliers: 1 });
    await expect(updateFirm(db.client, FIRM, { status: "reviewed" }, alice)).rejects.toMatchObject({ status: 409, code: "attention_open" } satisfies Partial<StoreError>);
  });

  it("its recorded confirmation clears it, and the book can be reviewed", async () => {
    const db = seed(200, { pilot_events: [{ id: "ev", firm_id: FIRM, kind: "rate_book_change", detail: { action: "outlier_confirmed", entry_id: "e-1" } }] });
    expect(await loadBookAttention(db.client, FIRM)).toEqual({ conflicts: 0, outliers: 0 });
    const f = await updateFirm(db.client, FIRM, { status: "reviewed" }, alice);
    expect(f.status).toBe("reviewed");
  });

  it("a rate inside the band never blocks", async () => {
    const db = seed(48);
    expect(await loadBookAttention(db.client, FIRM)).toEqual({ conflicts: 0, outliers: 0 });
  });
});

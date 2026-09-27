import { beforeEach, describe, expect, it } from "vitest";

import type { Caller } from "@/lib/auth/caller";
import { loadProjectFirmOverlay } from "@/lib/rates/firm";

import { assignProjectFirm, createEntry, createFirm, deleteEntry, getFirmSummary, promoteCorrection, updateEntry, updateFirm } from "../store";
import { fakeDb, type FakeDb } from "./fake-db";

// =============================================================================
// U2 — a book is a DRAFT until a member marks it reviewed, and any later change
// to its content returns it to draft. Status never changes what a project
// resolves (resolution is L1's, untouched).
// =============================================================================

const alice: Caller = { id: "00000000-0000-4000-8000-00000000a11c", email: "alice@firm-a.test" };
let db: FakeDb;

beforeEach(() => {
  db = fakeDb({ projects: [{ id: "p1", firm_id: null }], boq_corrections: [], firm_members: [] });
});

describe("book status", () => {
  it("a new firm has no book and reads as draft; marking reviewed creates the book and stamps reviewed_at", async () => {
    const A = await createFirm(db.client, { name: "Firm A" }, alice);
    const s0 = await getFirmSummary(db.client, A.id, alice);
    expect(s0).toMatchObject({ book_id: null, status: "draft", reviewed_at: null });
    const s1 = await updateFirm(db.client, A.id, { status: "reviewed" }, alice);
    expect(s1.book_id).not.toBeNull();
    expect(s1.status).toBe("reviewed");
    expect(s1.reviewed_at).toBeTruthy();
    const s2 = await updateFirm(db.client, A.id, { status: "draft" }, alice);
    expect(s2).toMatchObject({ status: "draft", reviewed_at: null });
  });

  it("adding, editing or deleting an entry returns a reviewed book to draft", async () => {
    const A = await createFirm(db.client, { name: "Firm A" }, alice);
    await updateFirm(db.client, A.id, { status: "reviewed" }, alice);
    const e = await createEntry(db.client, A.id, { item_key: "garden.pcc_base", unit: "m2", rate_aed: 95, kind: "labour" }, alice);
    expect((await getFirmSummary(db.client, A.id, alice)).status).toBe("draft");

    await updateFirm(db.client, A.id, { status: "reviewed" }, alice);
    await updateEntry(db.client, A.id, e.id, { rate_aed: 96 }, alice);
    expect((await getFirmSummary(db.client, A.id, alice)).status).toBe("draft");

    await updateFirm(db.client, A.id, { status: "reviewed" }, alice);
    await deleteEntry(db.client, A.id, e.id, alice);
    expect((await getFirmSummary(db.client, A.id, alice)).status).toBe("draft");
  });

  it("moving the OH&P returns it to draft; re-saving the same OH&P does not", async () => {
    const A = await createFirm(db.client, { name: "Firm A" }, alice);
    await updateFirm(db.client, A.id, { ohp_pct: 10 }, alice);
    await updateFirm(db.client, A.id, { status: "reviewed" }, alice);
    expect((await updateFirm(db.client, A.id, { ohp_pct: 10 }, alice)).status).toBe("reviewed");
    expect((await updateFirm(db.client, A.id, { ohp_pct: 12 }, alice)).status).toBe("draft");
    // One call that moves OH&P AND re-reviews ends reviewed.
    expect((await updateFirm(db.client, A.id, { ohp_pct: 15, status: "reviewed" }, alice)).status).toBe("reviewed");
  });

  it("a promotion is a content change too", async () => {
    const A = await createFirm(db.client, { name: "Firm A" }, alice);
    await updateFirm(db.client, A.id, { status: "reviewed" }, alice);
    db.tables.boq_corrections!.push({ id: "c1", project_id: "p1", firm_id: A.id, correction_type: "rate", item_key: "garden.pcc_base", line_description: "PCC", old_value: 105.6, new_value: 95, provenance: "market_fair", promoted_at: null });
    await promoteCorrection(db.client, A.id, { correction_id: "c1" }, alice);
    expect((await getFirmSummary(db.client, A.id, alice)).status).toBe("draft");
  });

  it("status changes nothing about what a project resolves", async () => {
    const A = await createFirm(db.client, { name: "Firm A" }, alice);
    await createEntry(db.client, A.id, { item_key: "garden.pcc_base", unit: "m2", rate_aed: 95, kind: "labour" }, alice);
    await assignProjectFirm(db.client, "p1", A.id, alice);
    const draft = (await loadProjectFirmOverlay(db.client, "p1")).lookup("garden.pcc_base", "standard", "m2");
    await updateFirm(db.client, A.id, { status: "reviewed" }, alice);
    const reviewed = (await loadProjectFirmOverlay(db.client, "p1")).lookup("garden.pcc_base", "standard", "m2");
    expect(draft).toEqual(reviewed);
    expect(draft?.entry.rate_aed).toBe(95);
  });
});

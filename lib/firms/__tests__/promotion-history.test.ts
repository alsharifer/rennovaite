import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type { Caller } from "@/lib/auth/caller";
import { loadFirmBook, loadProjectFirmOverlay } from "@/lib/rates/firm";

import { assignProjectFirm, createEntry, createFirm, deleteEntry, getFirmSummary, listEntries, listEntryHistory, promoteCorrection, StoreError, updateEntry, updateFirm } from "../store";
import { fakeDb, type FakeDb } from "./fake-db";

// =============================================================================
// U4 Part 2 — promotion supersede-with-history. The test list U0(d) named:
//   promote-over-existing · delete-of-promoted · re-promotion
// plus the origin guard on PATCH and the loader's deterministic order.
// Every case also asserts the invariant the flow exists for: no promoted
// record is ever deleted — the rows only grow.
// =============================================================================

const alice: Caller = { id: "00000000-0000-4000-8000-00000000a11c", email: "alice@firm-a.test" };
const bob: Caller = { id: "00000000-0000-4000-8000-000000000b0b", email: "bob@firm-b.test" };
let db: FakeDb;
let A: { id: string };
const correction = (id: string, firm_id: string, new_value: number, over: Record<string, unknown> = {}) => ({
  id, project_id: "p1", firm_id, correction_type: "rate", item_key: "garden.pcc_base", line_description: `PCC ${new_value}`, old_value: 105.6, new_value, provenance: "market_fair", promoted_at: null, promoted_entry_id: null, recorded_at: new Date().toISOString(), ...over,
});
const rows = () => db.tables.firm_rate_entries ?? [];
async function expectStoreError(p: Promise<unknown>, status: number, code?: string) {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(StoreError);
  expect((err as StoreError).status).toBe(status);
  if (code) expect((err as StoreError).code).toBe(code);
}

beforeEach(async () => {
  db = fakeDb({ projects: [{ id: "p1", firm_id: null }], boq_corrections: [], firm_members: [] });
  A = await createFirm(db.client, { name: "Firm A" }, alice);
  await assignProjectFirm(db.client, "p1", A.id, alice);
});

describe("promote-over-existing", () => {
  it("a second correction for the same item/grade supersedes the first — both kept, the trail says who/what/when", async () => {
    db.tables.boq_corrections!.push(correction("c1", A.id, 95), correction("c2", A.id, 91));
    const first = await promoteCorrection(db.client, A.id, { correction_id: "c1" }, alice);
    expect(first.superseded_entry_id).toBeNull();
    const second = await promoteCorrection(db.client, A.id, { correction_id: "c2" }, alice);
    expect(second.superseded_entry_id).toBe(first.entry.id);

    expect(rows()).toHaveLength(2); // nothing deleted
    const old = rows().find((r) => r.id === first.entry.id)!;
    expect(old).toMatchObject({ superseded_by: second.entry.id, retired_by: alice.id, retire_reason: "superseded by a later promotion" });
    expect(old.superseded_at).toBeTruthy();
    expect(rows().find((r) => r.id === second.entry.id)).toMatchObject({ rate_aed: 91, created_by: alice.id, superseded_at: null, correction_id: "c2" });
    // Both corrections remain marked with the entry they produced.
    expect(db.tables.boq_corrections!.find((c) => c.id === "c1")!.promoted_entry_id).toBe(first.entry.id);
    expect(db.tables.boq_corrections!.find((c) => c.id === "c2")!.promoted_entry_id).toBe(second.entry.id);

    // Only the new one prices; only the new one is listed as active.
    const hit = (await loadProjectFirmOverlay(db.client, "p1")).lookup("garden.pcc_base", "standard", "m2");
    expect(hit).toMatchObject({ tier: "firm_correction", entry: { id: second.entry.id, rate_aed: 91 } });
    expect((await listEntries(db.client, A.id, alice)).map((e) => e.id)).toEqual([second.entry.id]);

    // The trail, newest active first, then history.
    const trail = await listEntryHistory(db.client, A.id, "garden.pcc_base", alice);
    expect(trail.map((t) => [t.id, t.rate_aed, !!t.superseded_at])).toEqual([[second.entry.id, 91, false], [first.entry.id, 95, true]]);
  });

  it("a different grade is not superseded; a promotion returns a reviewed book to draft", async () => {
    db.tables.boq_corrections!.push(correction("c1", A.id, 95), correction("c2", A.id, 91));
    const std = await promoteCorrection(db.client, A.id, { correction_id: "c1", grade: "standard" }, alice);
    await updateFirm(db.client, A.id, { status: "reviewed" }, alice);
    const prem = await promoteCorrection(db.client, A.id, { correction_id: "c2", grade: "premium" }, alice);
    expect(prem.superseded_entry_id).toBeNull();
    expect(rows().filter((r) => !r.superseded_at)).toHaveLength(2);
    expect((await getFirmSummary(db.client, A.id, alice)).status).toBe("draft");
    void std;
  });

  it("the refusals are unchanged: other firm 403, already promoted 409, non-rate 422, unattributed 403", async () => {
    const B = await createFirm(db.client, { name: "Firm B" }, bob);
    db.tables.boq_corrections!.push(correction("c1", A.id, 95), correction("cb", B.id, 1), correction("cs", A.id, 1, { correction_type: "scope" }), correction("cn", null as unknown as string, 1));
    await promoteCorrection(db.client, A.id, { correction_id: "c1" }, alice);
    await expectStoreError(promoteCorrection(db.client, A.id, { correction_id: "c1" }, alice), 409, "already_promoted");
    await expectStoreError(promoteCorrection(db.client, A.id, { correction_id: "cb" }, alice), 403, "not_this_firms_correction");
    await expectStoreError(promoteCorrection(db.client, B.id, { correction_id: "c1" }, alice), 403, "not_a_member");
    await expectStoreError(promoteCorrection(db.client, A.id, { correction_id: "cs" }, alice), 422, "not_a_rate");
    await expectStoreError(promoteCorrection(db.client, A.id, { correction_id: "cn" }, alice), 403);
    expect(rows()).toHaveLength(1);
  });
});

describe("delete-of-promoted → retire, never delete", () => {
  it("DELETE retires the entry (kept, with who and why), stops it pricing, and frees the correction", async () => {
    db.tables.boq_corrections!.push(correction("c1", A.id, 95));
    const { entry } = await promoteCorrection(db.client, A.id, { correction_id: "c1" }, alice);
    await deleteEntry(db.client, A.id, entry.id, alice);
    expect(rows()).toHaveLength(1); // the row is still there
    expect(rows()[0]).toMatchObject({ id: entry.id, retired_by: alice.id, retire_reason: "retired by a member" });
    expect(rows()[0]!.superseded_at).toBeTruthy();
    expect((await listEntries(db.client, A.id, alice))).toEqual([]);
    expect((await loadProjectFirmOverlay(db.client, "p1")).lookup("garden.pcc_base", "standard", "m2")).toBeNull();
    // The trap U0 found is gone: the correction is re-promotable.
    const c = db.tables.boq_corrections!.find((x) => x.id === "c1")!;
    expect(c.promoted_at).toBeNull();
    expect(c.promoted_entry_id).toBeNull();
    // Retiring twice is refused, and a retired entry cannot be edited.
    await expectStoreError(deleteEntry(db.client, A.id, entry.id, alice), 409, "entry_retired");
    await expectStoreError(updateEntry(db.client, A.id, entry.id, { note: "x" }, alice), 409, "entry_retired");
  });

  it("a typed entry retires the same way — the module has no delete at all", async () => {
    const e = await createEntry(db.client, A.id, { item_key: "garden.pcc_base", unit: "m2", rate_aed: 77, kind: "labour" }, alice);
    await deleteEntry(db.client, A.id, e.id, alice);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.superseded_at).toBeTruthy();
    // And the key is free for a new active entry (partial unique index).
    const again = await createEntry(db.client, A.id, { item_key: "garden.pcc_base", unit: "m2", rate_aed: 78, kind: "labour" }, alice);
    expect(rows()).toHaveLength(2);
    expect((await listEntries(db.client, A.id, alice)).map((x) => x.id)).toEqual([again.id]);
  });

  it("static: lib/firms/store.ts and lib/quotes/store.ts contain no delete on firm_rate_entries", () => {
    for (const f of ["lib/firms/store.ts", "lib/quotes/store.ts"]) {
      const src = fs.readFileSync(path.resolve(__dirname, "../../..", f), "utf8");
      expect(src, f).not.toMatch(/from\("firm_rate_entries"\)[\s\S]{0,240}?\.delete\(/);
    }
  });
});

describe("re-promotion", () => {
  it("after its entry is retired, the same correction can be promoted again; while active it cannot", async () => {
    db.tables.boq_corrections!.push(correction("c1", A.id, 95));
    const first = await promoteCorrection(db.client, A.id, { correction_id: "c1" }, alice);
    await expectStoreError(promoteCorrection(db.client, A.id, { correction_id: "c1" }, alice), 409, "already_promoted");
    await deleteEntry(db.client, A.id, first.entry.id, alice);
    const second = await promoteCorrection(db.client, A.id, { correction_id: "c1", rate_aed: 96 }, alice);
    expect(second.entry.id).not.toBe(first.entry.id);
    expect(second.superseded_entry_id).toBeNull(); // the retired one was already inactive
    expect(rows()).toHaveLength(2);
    const trail = await listEntryHistory(db.client, A.id, "garden.pcc_base", alice);
    expect(trail).toHaveLength(2);
    expect(trail[0]).toMatchObject({ id: second.entry.id, rate_aed: 96, correction_id: "c1" });
    expect(trail[1]).toMatchObject({ id: first.entry.id, rate_aed: 95, retire_reason: "retired by a member" });
  });
});

describe("origin guard on PATCH", () => {
  it("a promoted rate's figures cannot be edited (only its note); a typed rate's can", async () => {
    db.tables.boq_corrections!.push(correction("c1", A.id, 95));
    const { entry } = await promoteCorrection(db.client, A.id, { correction_id: "c1" }, alice);
    await expectStoreError(updateEntry(db.client, A.id, entry.id, { rate_aed: 90 }, alice), 409, "entry_locked");
    await expectStoreError(updateEntry(db.client, A.id, entry.id, { grade: "premium" }, alice), 409, "entry_locked");
    await expectStoreError(updateEntry(db.client, A.id, entry.id, { kind: "lump" }, alice), 409, "entry_locked");
    expect((await updateEntry(db.client, A.id, entry.id, { note: "confirmed at the Sept review" }, alice)).rate_aed).toBe(95);
    expect(rows().find((r) => r.id === entry.id)!.note).toBe("confirmed at the Sept review");
    const typed = await createEntry(db.client, A.id, { item_key: "garden.grass_supply", unit: "m2", rate_aed: 20, kind: "supply" }, alice);
    expect((await updateEntry(db.client, A.id, typed.id, { rate_aed: 21 }, alice)).rate_aed).toBe(21);
  });
});

describe("loader ordering is deterministic", () => {
  it("active rows come back newest first, then by id — not in insertion luck", async () => {
    const a = await createEntry(db.client, A.id, { item_key: "garden.pcc_base", unit: "m2", rate_aed: 1, kind: "labour" }, alice);
    const b = await createEntry(db.client, A.id, { item_key: "garden.grass_supply", unit: "m2", rate_aed: 2, kind: "supply" }, alice);
    const c = await createEntry(db.client, A.id, { item_key: "garden.pergola", unit: "m2 plan", rate_aed: 3, kind: "supply_and_install" }, alice);
    const book = (await loadFirmBook(db.client, A.id))!;
    expect(book.entries.map((e) => e.id)).toEqual([c.id, b.id, a.id]);
  });
});

describe("a figure edit supersedes with history (UV)", () => {
  it("editing a typed rate retires the old row with the figure it carried, inserts the new one, and records the change", async () => {
    const typed = await createEntry(db.client, A.id, { item_key: "garden.grass_supply", unit: "m2", rate_aed: 20, kind: "supply" }, alice);
    const edited = await updateEntry(db.client, A.id, typed.id, { rate_aed: 21 }, alice);
    expect(edited.id).not.toBe(typed.id);
    expect(edited).toMatchObject({ item_key: "garden.grass_supply", rate_aed: 21, unit: "m2", kind: "supply", origin: "firm_entry", superseded_at: null });
    expect(rows()).toHaveLength(2); // nothing deleted
    const old = rows().find((r) => r.id === typed.id)!;
    expect(old).toMatchObject({ rate_aed: 20, superseded_by: edited.id, retired_by: alice.id, retire_reason: "edited by a member — was 20 per m2" });
    expect(old.superseded_at).toBeTruthy();
    // Only the new figure prices; the trail shows both.
    const hit = (await loadProjectFirmOverlay(db.client, "p1")).lookup("garden.grass_supply", "standard", "m2");
    expect(hit).toMatchObject({ tier: "firm_private", entry: { id: edited.id, rate_aed: 21 } });
    const trail = await listEntryHistory(db.client, A.id, "garden.grass_supply", alice);
    expect(trail.map((t) => t.rate_aed)).toEqual([21, 20]);
    const events = (db.tables.pilot_events ?? []).filter((e) => e.kind === "rate_book_change" && (e.detail as { action?: string })?.action === "edit");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ firm_id: A.id, actor: alice.id, detail: { item_key: "garden.grass_supply", entry_id: edited.id, superseded_entry_id: typed.id, from_rate_aed: 20, to_rate_aed: 21 } });
    // A note-only edit stays in place: a note is not a figure.
    const noted = await updateEntry(db.client, A.id, edited.id, { note: "confirmed" }, alice);
    expect(noted.id).toBe(edited.id);
    expect(rows()).toHaveLength(2);
    // The retired row cannot be edited again.
    await expectStoreError(updateEntry(db.client, A.id, typed.id, { rate_aed: 22 }, alice), 409, "entry_retired");
  });
});

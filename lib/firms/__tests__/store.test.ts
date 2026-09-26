import { beforeEach, describe, expect, it } from "vitest";

import type { Caller } from "@/lib/auth/caller";
import { FirmOverlay, loadProjectFirmOverlay } from "@/lib/rates/firm";

import {
  StoreError,
  assignProjectFirm,
  createEntry,
  createFirm,
  deleteEntry,
  deleteFirm,
  findOrCreateFirmByName,
  getFirmSummary,
  listEntries,
  listFirms,
  promoteCorrection,
  requireFirm,
  updateEntry,
  updateFirm,
} from "../store";
import { validateEntry } from "../vocabulary";
import { fakeDb, type FakeDb } from "./fake-db";

// =============================================================================
// L1 store: overlay CRUD, promotion, and the two privacy invariants that belong
// to the WRITE side — a firm can reach only its own book, and no operation ever
// touches the reference book (`rate_book` diff empty after EVERY operation).
//
// U1: every operation is made BY someone. `alice` owns what she creates, `bob`
// owns what he creates, `nobody` is a signed-out call. The privacy suite is
// upgraded from "firm A cannot address firm B's rows" (scoping, 404) to "an
// authenticated user of firm A is REFUSED firm B's routes, entries, corrections
// and promotions" (403 not_a_member) and "a signed-out call gets 401".
// =============================================================================

const REFERENCE = [
  { id: "r1", city: "Dubai", item_key: "garden.pcc_base", grade: "standard", unit: "m2", rate_aed: 105.6, scope: "install_only", provenance: "actual_transaction", valid_from: "2026-09-12", work_section: "Landscape & External Works", source: "market reference — Dubai garden 2026", internal_ref: "x" },
  { id: "r2", city: "Dubai", item_key: "floor_finish", grade: "standard", unit: "m2", rate_aed: 190, scope: null, provenance: "seed", valid_from: "2026-09-10", work_section: "Floor Finishes", source: "seed", internal_ref: null },
];

const alice: Caller = { id: "00000000-0000-4000-8000-00000000a11c", email: "alice@firm-a.test" };
const bob: Caller = { id: "00000000-0000-4000-8000-000000000b0b", email: "bob@firm-b.test" };
const nobody: Caller | null = null;

let db: FakeDb;
let snapshot: string;
const referenceUnchanged = () => expect(JSON.stringify(db.tables.rate_book)).toBe(snapshot);

async function expectStoreError(p: Promise<unknown>, status: number, code?: string) {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(StoreError);
  expect((err as StoreError).status).toBe(status);
  if (code) expect((err as StoreError).code).toBe(code);
}

beforeEach(() => {
  db = fakeDb({
    rate_book: REFERENCE,
    projects: [{ id: "p1", firm_id: null }, { id: "p2", firm_id: null }],
    boq_corrections: [],
    firm_members: [],
  });
  snapshot = JSON.stringify(db.tables.rate_book);
});

describe("firm rate book CRUD", () => {
  it("create → entry → patch → delete, and the reference book never moves", async () => {
    const firm = await createFirm(db.client, { name: "Scratch Firm", created_by: "test" }, alice);
    referenceUnchanged();
    expect(firm.private).toBe(true);
    expect((await getFirmSummary(db.client, firm.id, alice)).book_id).toBeNull(); // no book until one is needed

    const e = await createEntry(db.client, firm.id, { item_key: "garden.pcc_base", unit: "m2", rate_aed: 99, kind: "labour" }, alice);
    referenceUnchanged();
    expect(e).toMatchObject({ firm_id: firm.id, origin: "firm_entry", rate_aed: 99 });

    const patched = await updateEntry(db.client, firm.id, e.id, { rate_aed: 97.5 }, alice);
    referenceUnchanged();
    expect(patched.rate_aed).toBe(97.5);

    const s = await updateFirm(db.client, firm.id, { ohp_pct: 10 }, alice);
    referenceUnchanged();
    expect(s).toMatchObject({ ohp_pct: 10, entry_count: 1 });

    expect(await listEntries(db.client, firm.id, alice)).toHaveLength(1);
    await deleteEntry(db.client, firm.id, e.id, alice);
    referenceUnchanged();
    expect(await listEntries(db.client, firm.id, alice)).toHaveLength(0);

    await deleteFirm(db.client, firm.id, alice);
    referenceUnchanged();
  });

  it("the overlay a project resolves is its firm's, and only once assigned", async () => {
    const firm = await createFirm(db.client, { name: "Assign Firm" }, alice);
    await createEntry(db.client, firm.id, { item_key: "garden.pcc_base", unit: "m2", rate_aed: 88, kind: "labour" }, alice);
    expect((await loadProjectFirmOverlay(db.client, "p1")).firmId).toBeNull();
    await assignProjectFirm(db.client, "p1", firm.id, alice);
    const o = await loadProjectFirmOverlay(db.client, "p1");
    expect(o.lookup("garden.pcc_base", "standard", "m2")?.entry.rate_aed).toBe(88);
    await assignProjectFirm(db.client, "p1", null, alice);
    expect(await loadProjectFirmOverlay(db.client, "p1")).toEqual(FirmOverlay.none());
    referenceUnchanged();
  });

  it("validates against the take-off vocabulary", async () => {
    const firm = await createFirm(db.client, { name: "Vocab Firm" }, alice);
    await expectStoreError(createEntry(db.client, firm.id, { item_key: "garden.nope", unit: "m2", rate_aed: 1, kind: "labour" }, alice), 422, "invalid_entry");
    // Wrong unit for the key.
    await expectStoreError(createEntry(db.client, firm.id, { item_key: "garden.pcc_base", unit: "lm", rate_aed: 1, kind: "labour" }, alice), 422);
    // A supply-only material line never takes a supply-and-install rate (its labour line would be paid twice).
    expect(validateEntry({ item_key: "floor.porcelain_material", unit: "m2", rate_aed: 1, kind: "supply_and_install" })).not.toEqual([]);
    expect(validateEntry({ item_key: "floor.porcelain_material", unit: "m2", rate_aed: 1, kind: "supply" })).toEqual([]);
    // An item the market book cannot price is still a valid firm entry.
    expect(validateEntry({ item_key: "garden.deck", unit: "m2", rate_aed: 650, kind: "supply_and_install" })).toEqual([]);
    // One entry per key/grade/origin.
    await createEntry(db.client, firm.id, { item_key: "garden.pcc_base", unit: "m2", rate_aed: 1, kind: "labour" }, alice);
    await expectStoreError(createEntry(db.client, firm.id, { item_key: "garden.pcc_base", unit: "m2", rate_aed: 2, kind: "labour" }, alice), 409);
    referenceUnchanged();
  });

  it("normalises free-text attribution to one firm, case- and space-insensitively — for its member", async () => {
    const a = await findOrCreateFirmByName(db.client, "Newspace", "test", alice);
    const b = await findOrCreateFirmByName(db.client, "  newspace ", "test", alice);
    expect(b.id).toBe(a.id);
    expect(db.tables.firms).toHaveLength(1);
    // The name matches a firm bob is not a member of: refused, and no second firm is created.
    await expectStoreError(findOrCreateFirmByName(db.client, "NEWSPACE", "test", bob), 403, "not_a_member");
    expect(db.tables.firms).toHaveLength(1);
  });
});

describe("U1 — who is asking", () => {
  it("creating a firm makes the creator its member; listFirms is the caller's firms only", async () => {
    const A = await createFirm(db.client, { name: "Firm A" }, alice);
    const B = await createFirm(db.client, { name: "Firm B" }, bob);
    expect(db.tables.firm_members).toEqual([
      expect.objectContaining({ firm_id: A.id, user_id: alice.id }),
      expect.objectContaining({ firm_id: B.id, user_id: bob.id }),
    ]);
    expect((await listFirms(db.client, alice)).map((f) => f.id)).toEqual([A.id]);
    expect((await listFirms(db.client, bob)).map((f) => f.id)).toEqual([B.id]);
    expect(await listFirms(db.client, { id: "00000000-0000-4000-8000-0000000c0c0c", email: null })).toEqual([]);
  });

  it("signed out → 401 on every firm operation, before any firm is looked up", async () => {
    const A = await createFirm(db.client, { name: "Firm A" }, alice);
    const e = await createEntry(db.client, A.id, { item_key: "garden.pcc_base", unit: "m2", rate_aed: 1, kind: "labour" }, alice);
    const missing = "00000000-0000-4000-8000-00000000dead";
    await expectStoreError(listFirms(db.client, nobody), 401, "unauthenticated");
    await expectStoreError(createFirm(db.client, { name: "Anon Firm" }, nobody), 401, "unauthenticated");
    await expectStoreError(findOrCreateFirmByName(db.client, "Anon Firm", "test", nobody), 401, "unauthenticated");
    await expectStoreError(requireFirm(db.client, A.id, nobody), 401, "unauthenticated");
    await expectStoreError(requireFirm(db.client, missing, nobody), 401, "unauthenticated"); // not 404: existence is not disclosed
    await expectStoreError(getFirmSummary(db.client, A.id, nobody), 401);
    await expectStoreError(updateFirm(db.client, A.id, { ohp_pct: 5 }, nobody), 401);
    await expectStoreError(deleteFirm(db.client, A.id, nobody), 401);
    await expectStoreError(listEntries(db.client, A.id, nobody), 401);
    await expectStoreError(createEntry(db.client, A.id, { item_key: "garden.deck", unit: "m2", rate_aed: 1, kind: "supply_and_install" }, nobody), 401);
    await expectStoreError(updateEntry(db.client, A.id, e.id, { rate_aed: 2 }, nobody), 401);
    await expectStoreError(deleteEntry(db.client, A.id, e.id, nobody), 401);
    await expectStoreError(promoteCorrection(db.client, A.id, { correction_id: "c1" }, nobody), 401);
    await expectStoreError(assignProjectFirm(db.client, "p1", A.id, nobody), 401);
    await expectStoreError(assignProjectFirm(db.client, "p1", null, nobody), 401);
    expect(db.tables.firms).toHaveLength(1);
    expect(db.tables.firm_rate_entries).toHaveLength(1);
    referenceUnchanged();
  });

  it("a signed-in user of firm A is REFUSED firm B — 403 not_a_member on every route, on authentication grounds", async () => {
    await createFirm(db.client, { name: "Firm A" }, alice);
    const B = await createFirm(db.client, { name: "Firm B" }, bob);
    const eb = await createEntry(db.client, B.id, { item_key: "garden.pcc_base", unit: "m2", rate_aed: 177, kind: "labour" }, bob);
    await expectStoreError(requireFirm(db.client, B.id, alice), 403, "not_a_member");
    await expectStoreError(getFirmSummary(db.client, B.id, alice), 403, "not_a_member");
    await expectStoreError(updateFirm(db.client, B.id, { ohp_pct: 5 }, alice), 403, "not_a_member");
    await expectStoreError(deleteFirm(db.client, B.id, alice), 403, "not_a_member");
    await expectStoreError(listEntries(db.client, B.id, alice), 403, "not_a_member");
    await expectStoreError(createEntry(db.client, B.id, { item_key: "garden.deck", unit: "m2", rate_aed: 1, kind: "supply_and_install" }, alice), 403, "not_a_member");
    await expectStoreError(updateEntry(db.client, B.id, eb.id, { rate_aed: 1 }, alice), 403, "not_a_member");
    await expectStoreError(deleteEntry(db.client, B.id, eb.id, alice), 403, "not_a_member");
    await expectStoreError(assignProjectFirm(db.client, "p1", B.id, alice), 403, "not_a_member");
    // B's entry is untouched, B's firm still exists, and no project was assigned.
    expect((await listEntries(db.client, B.id, bob))[0]).toMatchObject({ id: eb.id, rate_aed: 177 });
    expect(db.tables.firms).toHaveLength(2);
    expect(db.tables.projects!.find((p) => p.id === "p1")!.firm_id).toBeNull();
    referenceUnchanged();
  });

  it("a firm that does not exist is 404 for a signed-in user (after the 401 check, before the 403 one)", async () => {
    const missing = "00000000-0000-4000-8000-00000000dead";
    await expectStoreError(requireFirm(db.client, missing, alice), 404, "firm_not_found");
    await expectStoreError(listEntries(db.client, missing, alice), 404, "firm_not_found");
    await expectStoreError(assignProjectFirm(db.client, "p1", missing, alice), 404, "firm_not_found");
  });

  it("detaching a firm from a project needs membership of THAT firm", async () => {
    const A = await createFirm(db.client, { name: "Firm A" }, alice);
    await assignProjectFirm(db.client, "p1", A.id, alice);
    await expectStoreError(assignProjectFirm(db.client, "p1", null, bob), 403, "not_a_member");
    expect(db.tables.projects!.find((p) => p.id === "p1")!.firm_id).toBe(A.id);
    await assignProjectFirm(db.client, "p1", null, alice);
    expect(db.tables.projects!.find((p) => p.id === "p1")!.firm_id).toBeNull();
  });

  it("scoping still holds underneath: B's entry through A's OWN path is 404 for A's member", async () => {
    const A = await createFirm(db.client, { name: "Firm A" }, alice);
    const B = await createFirm(db.client, { name: "Firm B" }, bob);
    const eb = await createEntry(db.client, B.id, { item_key: "garden.pcc_base", unit: "m2", rate_aed: 177, kind: "labour" }, bob);
    expect(await listEntries(db.client, A.id, alice)).toEqual([]);
    await expectStoreError(updateEntry(db.client, A.id, eb.id, { rate_aed: 1 }, alice), 404, "entry_not_found");
    await expectStoreError(deleteEntry(db.client, A.id, eb.id, alice), 404, "entry_not_found");
    expect((await listEntries(db.client, B.id, bob))[0]).toMatchObject({ id: eb.id, rate_aed: 177 });
    referenceUnchanged();
  });
});

describe("promotion — the only way a correction becomes a rate", () => {
  const correction = (over: Record<string, unknown>) => ({
    id: `c${Math.random().toString(36).slice(2, 8)}`,
    project_id: "p1",
    firm_id: null,
    correction_type: "rate",
    item_key: "garden.pcc_base",
    line_description: "PCC base under paving",
    old_value: 105.6,
    new_value: 95,
    provenance: "market_fair",
    promoted_at: null,
    ...over,
  });

  it("an unpromoted correction changes no rate", async () => {
    const A = await createFirm(db.client, { name: "Firm A" }, alice);
    db.tables.boq_corrections!.push(correction({ firm_id: A.id }));
    await assignProjectFirm(db.client, "p1", A.id, alice);
    const o = await loadProjectFirmOverlay(db.client, "p1");
    expect(o.lookup("garden.pcc_base", "standard", "m2")).toBeNull();
  });

  it("promotes the firm's own rate correction into tier 2, once", async () => {
    const A = await createFirm(db.client, { name: "Firm A" }, alice);
    const c = correction({ firm_id: A.id });
    db.tables.boq_corrections!.push(c);
    const { entry } = await promoteCorrection(db.client, A.id, { correction_id: c.id }, alice);
    referenceUnchanged();
    expect(entry).toMatchObject({ origin: "promoted_correction", correction_id: c.id, rate_aed: 95, unit: "m2", kind: "labour" });
    const marked = db.tables.boq_corrections!.find((x) => x.id === c.id)!;
    expect(marked.promoted_at).toBeTruthy();
    expect(marked.promoted_entry_id).toBe(entry.id);

    await assignProjectFirm(db.client, "p1", A.id, alice);
    const hit = (await loadProjectFirmOverlay(db.client, "p1")).lookup("garden.pcc_base", "standard", "m2");
    expect(hit).toMatchObject({ tier: "firm_correction" });

    await expectStoreError(promoteCorrection(db.client, A.id, { correction_id: c.id }, alice), 409, "already_promoted");
  });

  it("refuses another firm's correction, an unattributed one, and non-rate types", async () => {
    const A = await createFirm(db.client, { name: "Firm A" }, alice);
    const B = await createFirm(db.client, { name: "Firm B" }, bob);
    const bc = correction({ firm_id: B.id });
    const none = correction({ firm_id: null });
    const scope = correction({ firm_id: A.id, correction_type: "scope" });
    const noKey = correction({ firm_id: A.id, item_key: null });
    db.tables.boq_corrections!.push(bc, none, scope, noKey);
    await expectStoreError(promoteCorrection(db.client, A.id, { correction_id: bc.id }, alice), 403, "not_this_firms_correction");
    await expectStoreError(promoteCorrection(db.client, A.id, { correction_id: none.id }, alice), 403);
    await expectStoreError(promoteCorrection(db.client, A.id, { correction_id: scope.id }, alice), 422, "not_a_rate");
    await expectStoreError(promoteCorrection(db.client, A.id, { correction_id: noKey.id }, alice), 422, "no_item_key");
    expect(db.tables.firm_rate_entries ?? []).toHaveLength(0);
    referenceUnchanged();
  });

  it("U1: a user who is not a member cannot promote through the firm's route, even the firm's own correction", async () => {
    const A = await createFirm(db.client, { name: "Firm A" }, alice);
    const c = correction({ firm_id: A.id });
    db.tables.boq_corrections!.push(c);
    await expectStoreError(promoteCorrection(db.client, A.id, { correction_id: c.id }, bob), 403, "not_a_member");
    expect(db.tables.boq_corrections!.find((x) => x.id === c.id)!.promoted_at).toBeNull();
    expect(db.tables.firm_rate_entries ?? []).toHaveLength(0);
  });
});

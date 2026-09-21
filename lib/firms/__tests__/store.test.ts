import { beforeEach, describe, expect, it } from "vitest";

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
  promoteCorrection,
  updateEntry,
  updateFirm,
} from "../store";
import { validateEntry } from "../vocabulary";
import { fakeDb, type FakeDb } from "./fake-db";

// =============================================================================
// L1 store: overlay CRUD, promotion, and the two privacy invariants that belong
// to the WRITE side — a firm can reach only its own book, and no operation ever
// touches the reference book (`rate_book` diff empty after EVERY operation).
// =============================================================================

const REFERENCE = [
  { id: "r1", city: "Dubai", item_key: "garden.pcc_base", grade: "standard", unit: "m2", rate_aed: 105.6, scope: "install_only", provenance: "actual_transaction", valid_from: "2026-09-12", work_section: "Landscape & External Works", source: "market reference — Dubai garden 2026", internal_ref: "x" },
  { id: "r2", city: "Dubai", item_key: "floor_finish", grade: "standard", unit: "m2", rate_aed: 190, scope: null, provenance: "seed", valid_from: "2026-09-10", work_section: "Floor Finishes", source: "seed", internal_ref: null },
];

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
  });
  snapshot = JSON.stringify(db.tables.rate_book);
});

describe("firm rate book CRUD", () => {
  it("create → entry → patch → delete, and the reference book never moves", async () => {
    const firm = await createFirm(db.client, { name: "Scratch Firm", created_by: "test" });
    referenceUnchanged();
    expect(firm.private).toBe(true);
    expect((await getFirmSummary(db.client, firm.id)).book_id).toBeNull(); // no book until one is needed

    const e = await createEntry(db.client, firm.id, { item_key: "garden.pcc_base", unit: "m2", rate_aed: 99, kind: "labour" });
    referenceUnchanged();
    expect(e).toMatchObject({ firm_id: firm.id, origin: "firm_entry", rate_aed: 99 });

    const patched = await updateEntry(db.client, firm.id, e.id, { rate_aed: 97.5 });
    referenceUnchanged();
    expect(patched.rate_aed).toBe(97.5);

    const s = await updateFirm(db.client, firm.id, { ohp_pct: 10 });
    referenceUnchanged();
    expect(s).toMatchObject({ ohp_pct: 10, entry_count: 1 });

    expect(await listEntries(db.client, firm.id)).toHaveLength(1);
    await deleteEntry(db.client, firm.id, e.id);
    referenceUnchanged();
    expect(await listEntries(db.client, firm.id)).toHaveLength(0);

    await deleteFirm(db.client, firm.id);
    referenceUnchanged();
  });

  it("the overlay a project resolves is its firm's, and only once assigned", async () => {
    const firm = await createFirm(db.client, { name: "Assign Firm" });
    await createEntry(db.client, firm.id, { item_key: "garden.pcc_base", unit: "m2", rate_aed: 88, kind: "labour" });
    expect((await loadProjectFirmOverlay(db.client, "p1")).firmId).toBeNull();
    await assignProjectFirm(db.client, "p1", firm.id);
    const o = await loadProjectFirmOverlay(db.client, "p1");
    expect(o.lookup("garden.pcc_base", "standard", "m2")?.entry.rate_aed).toBe(88);
    await assignProjectFirm(db.client, "p1", null);
    expect(await loadProjectFirmOverlay(db.client, "p1")).toEqual(FirmOverlay.none());
    referenceUnchanged();
  });

  it("validates against the take-off vocabulary", async () => {
    const firm = await createFirm(db.client, { name: "Vocab Firm" });
    await expectStoreError(createEntry(db.client, firm.id, { item_key: "garden.nope", unit: "m2", rate_aed: 1, kind: "labour" }), 422, "invalid_entry");
    // Wrong unit for the key.
    await expectStoreError(createEntry(db.client, firm.id, { item_key: "garden.pcc_base", unit: "lm", rate_aed: 1, kind: "labour" }), 422);
    // A supply-only material line never takes a supply-and-install rate (its labour line would be paid twice).
    expect(validateEntry({ item_key: "floor.porcelain_material", unit: "m2", rate_aed: 1, kind: "supply_and_install" })).not.toEqual([]);
    expect(validateEntry({ item_key: "floor.porcelain_material", unit: "m2", rate_aed: 1, kind: "supply" })).toEqual([]);
    // An item the market book cannot price is still a valid firm entry.
    expect(validateEntry({ item_key: "garden.deck", unit: "m2", rate_aed: 650, kind: "supply_and_install" })).toEqual([]);
    // One entry per key/grade/origin.
    await createEntry(db.client, firm.id, { item_key: "garden.pcc_base", unit: "m2", rate_aed: 1, kind: "labour" });
    await expectStoreError(createEntry(db.client, firm.id, { item_key: "garden.pcc_base", unit: "m2", rate_aed: 2, kind: "labour" }), 409);
    referenceUnchanged();
  });

  it("normalises free-text attribution to one firm, case- and space-insensitively", async () => {
    const a = await findOrCreateFirmByName(db.client, "Newspace", "test");
    const b = await findOrCreateFirmByName(db.client, "  newspace ", "test");
    expect(b.id).toBe(a.id);
    expect(db.tables.firms).toHaveLength(1);
  });
});

describe("firm A cannot reach firm B's book through A's path", () => {
  it("read, update and delete of B's entry via A are NOT FOUND — and B's entry is untouched", async () => {
    const A = await createFirm(db.client, { name: "Firm A" });
    const B = await createFirm(db.client, { name: "Firm B" });
    const eb = await createEntry(db.client, B.id, { item_key: "garden.pcc_base", unit: "m2", rate_aed: 177, kind: "labour" });

    expect(await listEntries(db.client, A.id)).toEqual([]);
    await expectStoreError(updateEntry(db.client, A.id, eb.id, { rate_aed: 1 }), 404, "entry_not_found");
    await expectStoreError(deleteEntry(db.client, A.id, eb.id), 404, "entry_not_found");
    const still = (await listEntries(db.client, B.id))[0]!;
    expect(still).toMatchObject({ id: eb.id, rate_aed: 177 });
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
    const A = await createFirm(db.client, { name: "Firm A" });
    db.tables.boq_corrections!.push(correction({ firm_id: A.id }));
    await assignProjectFirm(db.client, "p1", A.id);
    const o = await loadProjectFirmOverlay(db.client, "p1");
    expect(o.lookup("garden.pcc_base", "standard", "m2")).toBeNull();
  });

  it("promotes the firm's own rate correction into tier 2, once", async () => {
    const A = await createFirm(db.client, { name: "Firm A" });
    const c = correction({ firm_id: A.id });
    db.tables.boq_corrections!.push(c);
    const { entry } = await promoteCorrection(db.client, A.id, { correction_id: c.id });
    referenceUnchanged();
    expect(entry).toMatchObject({ origin: "promoted_correction", correction_id: c.id, rate_aed: 95, unit: "m2", kind: "labour" });
    const marked = db.tables.boq_corrections!.find((x) => x.id === c.id)!;
    expect(marked.promoted_at).toBeTruthy();
    expect(marked.promoted_entry_id).toBe(entry.id);

    await assignProjectFirm(db.client, "p1", A.id);
    const hit = (await loadProjectFirmOverlay(db.client, "p1")).lookup("garden.pcc_base", "standard", "m2");
    expect(hit).toMatchObject({ tier: "firm_correction" });

    await expectStoreError(promoteCorrection(db.client, A.id, { correction_id: c.id }), 409, "already_promoted");
  });

  it("refuses another firm's correction, an unattributed one, and non-rate types", async () => {
    const A = await createFirm(db.client, { name: "Firm A" });
    const B = await createFirm(db.client, { name: "Firm B" });
    const bc = correction({ firm_id: B.id });
    const none = correction({ firm_id: null });
    const scope = correction({ firm_id: A.id, correction_type: "scope" });
    const noKey = correction({ firm_id: A.id, item_key: null });
    db.tables.boq_corrections!.push(bc, none, scope, noKey);
    await expectStoreError(promoteCorrection(db.client, A.id, { correction_id: bc.id }), 403, "not_this_firms_correction");
    await expectStoreError(promoteCorrection(db.client, A.id, { correction_id: none.id }), 403);
    await expectStoreError(promoteCorrection(db.client, A.id, { correction_id: scope.id }), 422, "not_a_rate");
    await expectStoreError(promoteCorrection(db.client, A.id, { correction_id: noKey.id }), 422, "no_item_key");
    expect(db.tables.firm_rate_entries ?? []).toHaveLength(0);
    referenceUnchanged();
  });
});

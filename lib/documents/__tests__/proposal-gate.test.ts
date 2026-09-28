import { beforeEach, describe, expect, it } from "vitest";

import type { Caller } from "@/lib/auth/caller";
import { fakeDb, type FakeDb } from "@/lib/firms/__tests__/fake-db";
import { StoreError, assignProjectFirm, createFirm, updateFirm } from "@/lib/firms/store";

import { acceptReferenceBasis, listAcceptances, loadProposalGate } from "../proposal-gate";

// L4 — the gate, loaded, and the acceptance event. The refusal path and the
// acceptance path are both exercised; a reviewed book passes without either.

const alice: Caller = { id: "00000000-0000-4000-8000-00000000a11c", email: "alice@firm-a.test" };
const bob: Caller = { id: "00000000-0000-4000-8000-000000000b0b", email: "bob@firm-b.test" };
const BOQ = "10000000-0000-4000-8000-000000000001";
const line = (rate_tier: string, rate_aed = 100) => ({ description: "PCC", quantity: 1, unit: "m2", rate_aed, total_aed: rate_aed, vendor_or_source: "market reference — Dubai garden 2026", notes: null, rate_tier });
const REF_BOQ = { sections: [{ work_section: "Hardscape & Structures", lines: [line("reference"), line("reference")] }], grand_total_aed: 200 };
const FIRM_BOQ = { sections: [{ work_section: "Hardscape & Structures", lines: [line("firm_private")] }], grand_total_aed: 100 };

let db: FakeDb;
let A: { id: string };
async function expectStoreError(p: Promise<unknown>, status: number, code: string) {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(StoreError);
  expect((err as StoreError).status).toBe(status);
  expect((err as StoreError).code).toBe(code);
}

beforeEach(async () => {
  db = fakeDb({ projects: [{ id: "p1", firm_id: null }], boqs: [{ id: BOQ, project_id: "p1", sections: REF_BOQ, created_at: "2026-09-27T09:00:00Z" }], firm_members: [] });
  A = await createFirm(db.client, { name: "Firm A" }, alice);
});

describe("loadProposalGate", () => {
  it("no firm → refused with the reason; the basis is still reported for the banner", async () => {
    const g = await loadProposalGate(db.client, "p1");
    expect(g.firm).toBeNull();
    expect(g.boq).toMatchObject({ id: BOQ, basis: { basis: "reference", reference_lines: 2 } });
    expect(g.verdict.ok).toBe(false);
    expect(g.verdict.refusal).toMatch(/attach the firm/i);
  });

  it("firm attached, book draft, reference-priced → refused; book reviewed → passes as book_reviewed", async () => {
    await assignProjectFirm(db.client, "p1", A.id, alice);
    const open = await loadProposalGate(db.client, "p1");
    // A firm with no book yet has no status: not reviewed, so not enough.
    expect(open.firm).toMatchObject({ firm_id: A.id, brand: "Firm A", book_status: null });
    expect(open.verdict).toMatchObject({ ok: false, reason: null });
    await updateFirm(db.client, A.id, { status: "reviewed" }, alice);
    expect((await loadProposalGate(db.client, "p1")).verdict).toMatchObject({ ok: true, reason: "book_reviewed" });
  });

  it("a firm-priced BoQ passes on its own basis", async () => {
    await assignProjectFirm(db.client, "p1", A.id, alice);
    db.tables.boqs![0]!.sections = FIRM_BOQ;
    expect((await loadProposalGate(db.client, "p1")).verdict).toMatchObject({ ok: true, reason: "firm_basis" });
  });

  it("the brand is the display name when set, the registered name otherwise", async () => {
    await assignProjectFirm(db.client, "p1", A.id, alice);
    db.tables.firms!.find((f) => f.id === A.id)!.display_name = "Firm A Landscapes";
    expect((await loadProposalGate(db.client, "p1")).firm!.brand).toBe("Firm A Landscapes");
  });
});

describe("acceptReferenceBasis", () => {
  it("401 anonymous; 422 when the project has no firm; 403 for a non-member; 404 for another project's BoQ", async () => {
    await expectStoreError(acceptReferenceBasis(db.client, "p1", { boq_id: BOQ }, null), 401, "unauthenticated");
    await expectStoreError(acceptReferenceBasis(db.client, "p1", { boq_id: BOQ }, alice), 422, "no_firm");
    await assignProjectFirm(db.client, "p1", A.id, alice);
    await expectStoreError(acceptReferenceBasis(db.client, "p1", { boq_id: BOQ }, bob), 403, "not_a_member");
    await expectStoreError(acceptReferenceBasis(db.client, "p1", { boq_id: "10000000-0000-4000-8000-000000000009" }, alice), 404, "boq_not_found");
  });

  it("a member accepts → an event for THIS revision; the gate then passes as accepted; a new revision needs its own", async () => {
    await assignProjectFirm(db.client, "p1", A.id, alice);
    const a = await acceptReferenceBasis(db.client, "p1", { boq_id: BOQ, note: "client agreed to market pricing" }, alice);
    expect(a).toMatchObject({ project_id: "p1", firm_id: A.id, boq_id: BOQ, accepted_by: alice.id, reference_lines: 2, note: "client agreed to market pricing" });
    const g = await loadProposalGate(db.client, "p1");
    expect(g.acceptance?.id).toBe(a.id);
    expect(g.verdict).toMatchObject({ ok: true, reason: "accepted" });
    expect(await listAcceptances(db.client, "p1")).toHaveLength(1);
    // A regenerated BoQ with IDENTICAL pricing is the basis the firm accepted (a
    // pack export regenerates before its gate); the acceptance carries over by fingerprint.
    db.tables.boqs!.push({ id: "10000000-0000-4000-8000-000000000002", project_id: "p1", sections: REF_BOQ, created_at: "2026-09-27T10:00:00Z" });
    const g2 = await loadProposalGate(db.client, "p1");
    expect(g2.boq!.id).toBe("10000000-0000-4000-8000-000000000002");
    expect(g2.acceptance?.id).toBe(a.id);
    expect(g2.verdict).toMatchObject({ ok: true, reason: "accepted" });
    // A revision where a line MOVED is a new basis: no acceptance covers it.
    const moved = { sections: [{ work_section: "Hardscape & Structures", lines: [line("reference"), line("reference", 120)] }], grand_total_aed: 220 };
    db.tables.boqs!.push({ id: "10000000-0000-4000-8000-000000000003", project_id: "p1", sections: moved, created_at: "2026-09-27T11:00:00Z" });
    const g3 = await loadProposalGate(db.client, "p1");
    expect(g3.acceptance).toBeNull();
    expect(g3.verdict.ok).toBe(false);
  });

  it("a firm-priced BoQ has nothing to accept (422)", async () => {
    await assignProjectFirm(db.client, "p1", A.id, alice);
    db.tables.boqs![0]!.sections = FIRM_BOQ;
    await expectStoreError(acceptReferenceBasis(db.client, "p1", { boq_id: BOQ }, alice), 422, "nothing_to_accept");
  });
});

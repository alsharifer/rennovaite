import { beforeEach, describe, expect, it } from "vitest";

import type { Caller } from "@/lib/auth/caller";
import { StoreError, createFirm } from "@/lib/firms/store";
import { fakeDb, type FakeDb } from "@/lib/firms/__tests__/fake-db";

import { approvalLabel, approvalStatus, listApprovals, recordApproval } from "../approvals";

// U4 — the approval trail: append-only rows, a firm's project is that firm's to
// approve, a client approval is an EVENT the firm records with name + date.

const alice: Caller = { id: "00000000-0000-4000-8000-00000000a11c", email: "alice@firm-a.test" };
const bob: Caller = { id: "00000000-0000-4000-8000-000000000b0b", email: "bob@firm-b.test" };
let db: FakeDb;
const BOQ1 = "10000000-0000-4000-8000-000000000001";
const BOQ2 = "10000000-0000-4000-8000-000000000002";
const OTHER = "10000000-0000-4000-8000-000000000009";

async function expectStoreError(p: Promise<unknown>, status: number, code: string) {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(StoreError);
  expect((err as StoreError).status).toBe(status);
  expect((err as StoreError).code).toBe(code);
}

beforeEach(() => {
  db = fakeDb({
    projects: [{ id: "p1", firm_id: null }, { id: "p2", firm_id: null }],
    boqs: [{ id: BOQ1, project_id: "p1" }, { id: BOQ2, project_id: "p1" }, { id: OTHER, project_id: "p2" }],
    firm_members: [],
  });
});

describe("recordApproval", () => {
  it("401 for nobody; a project with no firm is approvable by any signed-in account", async () => {
    await expectStoreError(recordApproval(db.client, "p1", { boq_id: BOQ1, kind: "firm" }, null), 401, "unauthenticated");
    const a = await recordApproval(db.client, "p1", { boq_id: BOQ1, kind: "firm", note: "reviewed at the Sept meeting" }, alice);
    expect(a).toMatchObject({ project_id: "p1", boq_id: BOQ1, kind: "firm", approved_by: alice.id, client_name: null, client_date: null, firm_id: null });
    expect(approvalLabel(a)).toBe(`Approved by the firm · ${a.created_at.slice(0, 10)}`);
  });

  it("a project WITH a firm is that firm's to approve — 403 for a non-member; the row carries the firm", async () => {
    const A = await createFirm(db.client, { name: "Firm A" }, alice);
    db.tables.projects!.find((p) => p.id === "p1")!.firm_id = A.id;
    await expectStoreError(recordApproval(db.client, "p1", { boq_id: BOQ1, kind: "firm" }, bob), 403, "not_a_member");
    const a = await recordApproval(db.client, "p1", { boq_id: BOQ1, kind: "firm" }, alice);
    expect(a.firm_id).toBe(A.id);
  });

  it("a client approval needs the name and the date the client gave", async () => {
    await expectStoreError(recordApproval(db.client, "p1", { boq_id: BOQ1, kind: "client" }, alice), 422, "client_details_required");
    await expectStoreError(recordApproval(db.client, "p1", { boq_id: BOQ1, kind: "client", client_name: "H. Client", client_date: "yesterday" }, alice), 422, "client_details_required");
    const a = await recordApproval(db.client, "p1", { boq_id: BOQ1, kind: "client", client_name: "  H. Client ", client_date: "2026-09-20" }, alice);
    expect(a).toMatchObject({ kind: "client", client_name: "H. Client", client_date: "2026-09-20", approved_by: alice.id });
    expect(approvalLabel(a)).toBe("Client approval recorded by the firm · H. Client · 2026-09-20");
  });

  it("a revision of another project is 404; an unknown project is 404", async () => {
    await expectStoreError(recordApproval(db.client, "p1", { boq_id: OTHER, kind: "firm" }, alice), 404, "boq_not_found");
    await expectStoreError(recordApproval(db.client, "nope", { boq_id: BOQ1, kind: "firm" }, alice), 404, "project_not_found");
  });
});

describe("the trail", () => {
  it("is append-only and per revision; status is the latest of each kind", async () => {
    await recordApproval(db.client, "p1", { boq_id: BOQ1, kind: "firm" }, alice);
    await recordApproval(db.client, "p1", { boq_id: BOQ1, kind: "client", client_name: "H. Client", client_date: "2026-09-20" }, alice);
    await recordApproval(db.client, "p1", { boq_id: BOQ2, kind: "firm" }, alice);
    const all = await listApprovals(db.client, "p1");
    expect(all).toHaveLength(3);
    expect(all.map((a) => a.boq_id)).toEqual([BOQ1, BOQ1, BOQ2]); // oldest first
    const s1 = approvalStatus(all, BOQ1);
    expect(s1.firm?.kind).toBe("firm");
    expect(s1.client?.client_name).toBe("H. Client");
    expect(s1.trail).toHaveLength(2);
    const s2 = approvalStatus(all, BOQ2);
    expect(s2.client).toBeNull();
    expect(approvalStatus(all, OTHER).trail).toEqual([]);
    expect(await listApprovals(db.client, "p2")).toEqual([]);
  });

  it("a database without the 046 table lists nothing rather than failing", async () => {
    const bare = fakeDb({ projects: [{ id: "p1", firm_id: null }] });
    // The fake returns an empty table for an unknown name; emulate the real missing-table error.
    (bare.client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      if (t !== "boq_approvals") throw new Error("unexpected table");
      const q = { select: () => q, eq: () => q, order: () => q, then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: "42P01", message: 'relation "boq_approvals" does not exist' } }).then(res) };
      return q;
    };
    expect(await listApprovals(bare.client, "p1")).toEqual([]);
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import type { Caller } from "@/lib/auth/caller";
import { StoreError, assignProjectFirm, createFirm } from "@/lib/firms/store";
import { fakeDb, type FakeDb } from "@/lib/firms/__tests__/fake-db";

import { addProjectMember } from "../access";
import { membersOutsideFirm } from "../firm-invariant";

// =============================================================================
// K2 review (13 Oct) — the persona invariant: on a firm-attached project,
// every project member is a member of that firm. Enforced at the two places
// that can break it: adding a project member, attaching a firm.
// =============================================================================

const alice: Caller = { id: "00000000-0000-4000-8000-00000000a11c", email: "alice@firm-a.test" };
const bob: Caller = { id: "00000000-0000-4000-8000-000000000b0b", email: "bob@elsewhere.test" };

let db: FakeDb;
beforeEach(() => {
  db = fakeDb({
    projects: [{ id: "p1", firm_id: null }, { id: "p2", firm_id: null }],
    project_members: [{ project_id: "p1", user_id: alice.id }],
  });
});

async function refusal(fn: () => Promise<unknown>): Promise<{ status: number; code: string } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof StoreError) return { status: e.status, code: e.code };
    throw e;
  }
}

describe("membersOutsideFirm", () => {
  it("lists the project members the firm does not include (once each)", () => {
    expect(membersOutsideFirm(["a", "b", "b", "c"], ["a", "c"])).toEqual(["b"]);
    expect(membersOutsideFirm(["a"], ["a", "z"])).toEqual([]);
    expect(membersOutsideFirm([], [])).toEqual([]);
  });
});

describe("firm attach", () => {
  it("attaches when every project member is in the firm", async () => {
    const A = await createFirm(db.client, { name: "Firm A" }, alice); // alice is now a member of A
    expect(await refusal(() => assignProjectFirm(db.client, "p1", A.id, alice))).toBeNull();
    expect(db.tables.projects!.find((p) => p.id === "p1")!.firm_id).toBe(A.id);
  });

  it("refuses when a project member is outside the firm — 409, and the project is unchanged", async () => {
    const A = await createFirm(db.client, { name: "Firm A" }, alice);
    db.tables.project_members!.push({ project_id: "p1", user_id: bob.id });
    expect(await refusal(() => assignProjectFirm(db.client, "p1", A.id, alice))).toEqual({ status: 409, code: "project_members_outside_firm" });
    expect(db.tables.projects!.find((p) => p.id === "p1")!.firm_id).toBeNull();
  });

  it("detaching is always allowed (no firm, no invariant)", async () => {
    const A = await createFirm(db.client, { name: "Firm A" }, alice);
    await assignProjectFirm(db.client, "p1", A.id, alice);
    expect(await refusal(() => assignProjectFirm(db.client, "p1", null, alice))).toBeNull();
  });
});

describe("member add", () => {
  it("anyone may join a project with no firm (project creation)", async () => {
    expect(await refusal(() => addProjectMember(db.client, "p2", bob.id))).toBeNull();
  });

  it("on a firm project only a firm member may join — 409 not_a_firm_member, nothing written", async () => {
    const A = await createFirm(db.client, { name: "Firm A" }, alice);
    await assignProjectFirm(db.client, "p1", A.id, alice);
    const before = db.tables.project_members!.length;
    expect(await refusal(() => addProjectMember(db.client, "p1", bob.id))).toEqual({ status: 409, code: "not_a_firm_member" });
    expect(db.tables.project_members!.length).toBe(before);
  });

  it("a firm member may join the firm's project", async () => {
    const A = await createFirm(db.client, { name: "Firm A" }, alice);
    await assignProjectFirm(db.client, "p2", A.id, alice);
    expect(await refusal(() => addProjectMember(db.client, "p2", alice.id))).toBeNull();
    expect(db.tables.project_members!.some((m) => m.project_id === "p2" && m.user_id === alice.id)).toBe(true);
  });
});

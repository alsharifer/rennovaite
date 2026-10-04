import { beforeEach, describe, expect, it } from "vitest";

import type { Caller } from "@/lib/auth/caller";
import { fakeDb, type FakeDb } from "@/lib/firms/__tests__/fake-db";

import { StoreError, addProjectMember, authorizeProject, memberProjectIds, type ProjectRefs } from "../access";

// H5 — project ownership, mirroring U1's store tests: 401, then 404, then 403,
// cross-project refusals, and the mixed-reference case a project-id-only check
// would miss (my project's id beside YOUR room).

const alice: Caller = { id: "00000000-0000-4000-8000-00000000a11c", email: "alice@one.test" };
const bob: Caller = { id: "00000000-0000-4000-8000-000000000b0b", email: "bob@two.test" };

let db: FakeDb;
beforeEach(() => {
  db = fakeDb({
    projects: [{ id: "p1" }, { id: "p2" }],
    plans: [{ id: "pl1", project_id: "p1" }, { id: "pl2", project_id: "p2" }],
    rooms: [{ id: "r1", plan_id: "pl1" }, { id: "r2", plan_id: "pl2" }],
    renders: [{ id: "rd1", project_id: "p1", prediction_id: "pred1" }, { id: "rd2", project_id: "p2", prediction_id: "pred2" }],
    project_assets: [{ id: "as1", project_id: "p1" }],
    boqs: [{ id: "bq1", project_id: "p1" }, { id: "bq2", project_id: "p2" }],
    plan_fixtures: [{ id: "fx1", project_id: "p1" }],
    plan_elements: [{ id: "el1", plan_id: "pl1" }],
    plan_openings: [{ id: "op1", plan_id: "pl1" }],
    plan_context: [{ id: "cx1", plan_id: "pl1" }],
    moodboard_items: [{ id: "mb1", project_id: "p1" }],
    project_members: [
      { project_id: "p1", user_id: alice.id },
      { project_id: "p2", user_id: bob.id },
    ],
  });
});

async function denied(refs: ProjectRefs, caller: Caller | null): Promise<{ status: number; code: string } | null> {
  try {
    await authorizeProject(db.client, caller, refs);
    return null;
  } catch (e) {
    if (e instanceof StoreError) return { status: e.status, code: e.code };
    throw e;
  }
}

describe("authorizeProject — the order", () => {
  it("401 for nobody, before anything is looked up (even a project that does not exist)", async () => {
    expect(await denied({ project_id: "nope" }, null)).toEqual({ status: 401, code: "unauthenticated" });
  });

  it("404 for an id that does not exist — named by kind", async () => {
    expect(await denied({ project_id: "nope" }, alice)).toEqual({ status: 404, code: "project_not_found" });
    expect(await denied({ room_id: "nope" }, alice)).toEqual({ status: 404, code: "room_not_found" });
    expect(await denied({ render_id: "nope" }, alice)).toEqual({ status: 404, code: "render_not_found" });
    expect(await denied({ element_id: "nope" }, alice)).toEqual({ status: 404, code: "element_not_found" });
  });

  it("403 for a project the caller is not a member of", async () => {
    expect(await denied({ project_id: "p2" }, alice)).toEqual({ status: 403, code: "not_a_project_member" });
    expect(await denied({ project_id: "p1" }, bob)).toEqual({ status: 403, code: "not_a_project_member" });
  });

  it("a member gets the project back", async () => {
    expect(await authorizeProject(db.client, alice, { project_id: "p1" })).toBe("p1");
    expect(await authorizeProject(db.client, bob, { project_id: "p2" })).toBe("p2");
  });
});

describe("authorizeProject — every reference kind resolves to its project", () => {
  const P1: ProjectRefs[] = [
    { plan_id: "pl1" },
    { room_id: "r1" },
    { render_id: "rd1" },
    { prediction_id: "pred1" },
    { asset_id: "as1" },
    { boq_id: "bq1" },
    { fixture_id: "fx1" },
    { element_id: "el1" },
    { opening_id: "op1" },
    { context_id: "cx1" },
    { moodboard_item_id: "mb1" },
  ];
  it.each(P1.map((r) => [Object.keys(r)[0], r] as const))("%s: allowed for p1's member, 403 for anyone else", async (_k, refs) => {
    expect(await authorizeProject(db.client, alice, refs)).toBe("p1");
    expect(await denied(refs, bob)).toEqual({ status: 403, code: "not_a_project_member" });
  });
});

describe("authorizeProject — mixed references (the check a project-id-only gate misses)", () => {
  it("my project's id beside YOUR room / render / BoQ → 403", async () => {
    expect(await denied({ project_id: "p2", room_id: "r1" }, bob)).toEqual({ status: 403, code: "not_a_project_member" });
    expect(await denied({ project_id: "p2", render_id: "rd1" }, bob)).toEqual({ status: 403, code: "not_a_project_member" });
    expect(await denied({ project_id: "p2", boq_id: "bq1" }, bob)).toEqual({ status: 403, code: "not_a_project_member" });
  });

  it("ids from two projects the caller belongs to both of → 400, never silently one of them", async () => {
    await addProjectMember(db.client, "p2", alice.id);
    expect(await denied({ project_id: "p1", room_id: "r2" }, alice)).toEqual({ status: 400, code: "refs_span_projects" });
  });

  it("refuses a call with no reference at all (a programming error, not a pass)", async () => {
    await expect(authorizeProject(db.client, alice, {})).rejects.toThrow(/no project reference/);
  });
});

describe("membership", () => {
  it("creating makes you a member, idempotently; the dashboard lists only yours", async () => {
    db.tables.projects!.push({ id: "p3" });
    await addProjectMember(db.client, "p3", bob.id);
    await addProjectMember(db.client, "p3", bob.id);
    expect(db.tables.project_members!.filter((m) => m.project_id === "p3")).toHaveLength(1);
    expect((await memberProjectIds(db.client, bob.id)).sort()).toEqual(["p2", "p3"]);
    expect(await memberProjectIds(db.client, alice.id)).toEqual(["p1"]);
  });
});

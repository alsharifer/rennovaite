import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type { Caller } from "@/lib/auth/caller";
import { fakeDb, type FakeDb } from "@/lib/firms/__tests__/fake-db";
import { assignProjectFirm } from "@/lib/firms/store";
import { loadProjectJourney } from "@/lib/journey-facts";

import { NOT_CREATOR_REASON } from "../firm-invariant";
import { moveFirmPreview } from "../move-firm";

// K11 #5 — "Move to firm…": attach → the firm journey; detach → the owner
// journey; blocked while a project member is not in the firm. The rules live
// in assignProjectFirm (PATCH /api/projects/:id { firm_id }); the preview the
// dialog reads answers the same ones per option.

const owner: Caller = { id: "00000000-0000-4000-8000-0000000000a1", email: "owner@one.test" };
const helper: Caller = { id: "00000000-0000-4000-8000-0000000000a2", email: "helper@one.test" };
const F = "f0000000-0000-4000-8000-000000000001";
const G = "f0000000-0000-4000-8000-000000000002";

let db: FakeDb;
beforeEach(() => {
  db = fakeDb({
    projects: [{ id: "p1", name: "Villa", display_name: null, city: "Dubai", firm_id: null, created_by: owner.id }],
    project_members: [{ project_id: "p1", user_id: owner.id }],
    firms: [
      { id: F, name: "Studio North", created_by: owner.email },
      { id: G, name: "Garden Co", created_by: helper.email },
    ],
    firm_members: [
      { firm_id: F, user_id: owner.id, role: "admin" },
      { firm_id: G, user_id: helper.id, role: "admin" },
    ],
  });
});
const firmOf = () => db.tables.projects!.find((p) => p.id === "p1")!.firm_id;
const journey = async (who: Caller) => {
  const mine = db.tables.firm_members!.filter((m) => m.user_id === who.id).map((m) => ({ id: m.firm_id as string, name: String(db.tables.firms!.find((f) => f.id === m.firm_id)!.name) }));
  return (await loadProjectJourney(db.client, "p1", who, mine)).persona;
};

describe("attach → firm journey; detach → owner journey", () => {
  it("the creator, a member of the firm, attaches it: the project is the firm's and the journey is 00–08", async () => {
    expect(await journey(owner)).toBe("owner");
    const pre = await moveFirmPreview(db.client, "p1", owner);
    expect(pre.options.map((o) => [o.name, o.allowed])).toEqual([
      ["Studio North", true],
      ["No firm — personal project", false],
    ]);
    expect(pre.options.at(-1)).toMatchObject({ current: true, reason: "The project is personal now." });
    await assignProjectFirm(db.client, "p1", F, owner);
    expect(firmOf()).toBe(F);
    expect(await journey(owner)).toBe("firm");
  });

  it("a member of the current firm detaches it: personal again, the owner journey", async () => {
    await assignProjectFirm(db.client, "p1", F, owner);
    const pre = await moveFirmPreview(db.client, "p1", owner);
    expect(pre.currentFirm).toEqual({ id: F, name: "Studio North" });
    expect(pre.options.find((o) => o.firmId === null)).toMatchObject({ allowed: true, current: false });
    await assignProjectFirm(db.client, "p1", null, owner);
    expect(firmOf()).toBeNull();
    expect(await journey(owner)).toBe("owner");
  });
});

describe("blocked", () => {
  it("while a project member is not in the firm — named, and the PATCH refuses with the same reason", async () => {
    db.tables.project_members!.push({ project_id: "p1", user_id: helper.id });
    const opt = (await moveFirmPreview(db.client, "p1", owner)).options.find((o) => o.firmId === F)!;
    expect(opt.allowed).toBe(false);
    expect(opt.outside).toHaveLength(1);
    expect(opt.reason).toMatch(/^1 person on this project is not in Studio North: .+\. Add them to the firm first/);
    await expect(assignProjectFirm(db.client, "p1", F, owner)).rejects.toMatchObject({ status: 409, code: "project_members_outside_firm" });
    expect(firmOf()).toBeNull();
  });

  it("for anyone but the project's creator", async () => {
    // helper is on the project and admin of Garden Co, but did not create the project.
    db.tables.project_members!.push({ project_id: "p1", user_id: helper.id });
    db.tables.firm_members!.push({ firm_id: G, user_id: owner.id, role: "member" });
    const opt = (await moveFirmPreview(db.client, "p1", helper)).options.find((o) => o.firmId === G)!;
    expect(opt).toMatchObject({ allowed: false, reason: NOT_CREATOR_REASON });
    await expect(assignProjectFirm(db.client, "p1", G, helper)).rejects.toMatchObject({ status: 403, code: "not_project_creator" });
  });

  it("detaching needs a member of the current firm", async () => {
    await assignProjectFirm(db.client, "p1", F, owner);
    const stranger: Caller = { id: "00000000-0000-4000-8000-0000000000ff", email: "x@else.test" };
    db.tables.project_members!.push({ project_id: "p1", user_id: stranger.id });
    expect((await moveFirmPreview(db.client, "p1", stranger)).options.find((o) => o.firmId === null)).toMatchObject({ allowed: false, reason: "Only a member of Studio North can make it a personal project." });
    await expect(assignProjectFirm(db.client, "p1", null, stranger)).rejects.toMatchObject({ status: 403, code: "not_a_member" });
  });
});

it("the menu offers Move to firm…, and the dialog PATCHes { firm_id }", () => {
  const src = readFileSync(path.resolve(__dirname, "../../../components/blueprint/projects/ProjectActions.tsx"), "utf8");
  expect(src).toMatch(/Move to firm…/);
  expect(src).toMatch(/send\(`\/api\/projects\/\$\{project\.id\}`, "PATCH", \{ firm_id: selected\.firmId \}\)/);
  expect(src).toMatch(/move-preview/);
});

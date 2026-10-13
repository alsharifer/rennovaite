import { beforeEach, describe, expect, it } from "vitest";

import type { Caller } from "@/lib/auth/caller";
import { fakeDb, type FakeDb } from "@/lib/firms/__tests__/fake-db";

import { authorizeProject, isProjectMember, memberProjectIds } from "../access";
import {
  DELETE_REFUSED_FIRM,
  DELETE_REFUSED_OWNER,
  deleteNow,
  deletePermissionOf,
  deletePreview,
  listRecentlyDeleted,
  nameMatches,
  projectStoragePrefixes,
  purgeExpiredProjects,
  restoreProject,
  softDeleteProject,
} from "../lifecycle";
import { StoreError } from "../access";

// K10 #1 (spec §6.12) — project delete is soft, permissioned, restorable, and
// purged with its Storage objects. Synthetic rows and synthetic files only.

const owner: Caller = { id: "00000000-0000-4000-8000-0000000000a1", email: "owner@one.test" };
const helper: Caller = { id: "00000000-0000-4000-8000-0000000000a2", email: "helper@one.test" };
const admin: Caller = { id: "00000000-0000-4000-8000-0000000000f1", email: "admin@firm.test" };
const member: Caller = { id: "00000000-0000-4000-8000-0000000000f2", email: "member@firm.test" };
const stranger: Caller = { id: "00000000-0000-4000-8000-0000000000ff", email: "x@else.test" };

/** In-memory Storage: list one folder level at a time (folders have id null), remove by path. */
function fakeStorage(files: Record<string, string[]>) {
  const buckets = new Map(Object.entries(files).map(([b, ps]) => [b, new Set(ps)]));
  return {
    buckets,
    from(bucket: string) {
      const set = (buckets.get(bucket) ?? buckets.set(bucket, new Set()).get(bucket))!;
      return {
        async list(prefix: string, opts: { limit: number; offset: number }) {
          const level = new Map<string, { name: string; id: string | null; created_at: string }>();
          for (const p of set) {
            if (!p.startsWith(`${prefix}/`)) continue;
            const rest = p.slice(prefix.length + 1);
            const [head, ...tail] = rest.split("/");
            level.set(head!, { name: head!, id: tail.length ? null : `id-${p}`, created_at: "2026-09-01T00:00:00Z" });
          }
          return { data: [...level.values()].slice(opts.offset, opts.offset + opts.limit), error: null };
        },
        async remove(paths: string[]) {
          for (const p of paths) set.delete(p);
          return { data: null, error: null };
        },
      };
    },
  };
}

let db: FakeDb;
let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  db = fakeDb({
    projects: [
      { id: "own", name: "Villa 12, The Springs", display_name: null, firm_id: null, created_by: owner.id, deleted_at: null, deleted_by: null },
      { id: "frm", name: "Townhouse 7", display_name: "Townhouse 7, Al Barari", firm_id: "f1", created_by: member.id, deleted_at: null, deleted_by: null },
      { id: "other", name: "Someone else", display_name: null, firm_id: null, created_by: stranger.id, deleted_at: null, deleted_by: null },
    ],
    project_members: [
      { project_id: "own", user_id: owner.id },
      { project_id: "own", user_id: helper.id },
      { project_id: "frm", user_id: admin.id },
      { project_id: "frm", user_id: member.id },
      { project_id: "other", user_id: stranger.id },
    ],
    firm_members: [
      { firm_id: "f1", user_id: admin.id, role: "admin" },
      { firm_id: "f1", user_id: member.id, role: "member" },
    ],
    plans: [{ id: "pl-own", project_id: "own" }],
    rooms: [{ id: "r-own", plan_id: "pl-own" }],
    boqs: [{ id: "bq1", project_id: "own" }, { id: "bq2", project_id: "own" }, { id: "bq3", project_id: "frm" }],
    renders: [{ id: "rd1", project_id: "own" }],
    approved_designs: [{ id: "ad1", project_id: "own" }],
    project_assets: [{ id: "as1", project_id: "own" }, { id: "as2", project_id: "own" }],
    pack_exports: [{ id: "pk1", project_id: "frm", status: "passed", options: { proposal: true } }],
  });
  storage = fakeStorage({
    "plan-uploads": ["own/plan.pdf", "own/assets/a.jpg", "own/rooms/r1/p.jpg", "other/plan.pdf"],
    renders: ["projects/own/renders/rd1.png", "projects/own/scene/abc-day.png", "projects/other/renders/x.png"],
    packs: ["projects/own/job1/pack.pdf", "downloads/own/u1/big.pdf", "projects/other/job/x.pdf"],
    drawings: ["projects/own/drawings/as_built.svg"],
    uploads: ["pending/plan/own/u/abc.pdf", "pending/plan/other/u/def.pdf"],
  });
  (db.client as unknown as { storage: unknown }).storage = storage;
  (db.client as unknown as { auth: unknown }).auth = { admin: { getUserById: async () => ({ data: { user: { email: "j.demo@firm.test" } } }) } };
});

async function refused(p: Promise<unknown>): Promise<{ status: number; code: string; message: string } | null> {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof StoreError) return { status: e.status, code: e.code, message: e.message };
    throw e;
  }
}

describe("who may delete", () => {
  it("owner project → its creator; firm project → a firm admin; everyone else gets the reason", () => {
    expect(deletePermissionOf({ firm_id: null, created_by: owner.id }, owner.id, false)).toEqual({ allowed: true, reason: null });
    expect(deletePermissionOf({ firm_id: null, created_by: owner.id }, helper.id, false)).toEqual({ allowed: false, reason: DELETE_REFUSED_OWNER });
    expect(deletePermissionOf({ firm_id: "f1", created_by: member.id }, admin.id, true)).toEqual({ allowed: true, reason: null });
    // The creator of a FIRM project is not enough — the firm's admin decides.
    expect(deletePermissionOf({ firm_id: "f1", created_by: member.id }, member.id, false)).toEqual({ allowed: false, reason: DELETE_REFUSED_FIRM });
    expect(DELETE_REFUSED_FIRM).toBe("Only a firm admin can delete this project");
  });

  it("a non-admin firm member cannot delete (403 not_allowed_to_delete); the admin can", async () => {
    expect(await refused(softDeleteProject(db.client, "frm", member, "Townhouse 7, Al Barari"))).toEqual({ status: 403, code: "not_allowed_to_delete", message: DELETE_REFUSED_FIRM });
    expect(await refused(softDeleteProject(db.client, "own", helper, "Villa 12, The Springs"))).toMatchObject({ status: 403, code: "not_allowed_to_delete" });
    expect(await refused(softDeleteProject(db.client, "frm", admin, "townhouse 7, al barari  "))).toBeNull();
  });

  it("a non-member is told the project does not exist (404), never that they may not delete it", async () => {
    expect(await refused(softDeleteProject(db.client, "own", stranger, "Villa 12, The Springs"))).toMatchObject({ status: 404, code: "project_not_found" });
    expect(await refused(softDeleteProject(db.client, "own", null, "x"))).toMatchObject({ status: 401 });
  });

  it("the typed name must match (case-insensitive, trimmed)", async () => {
    expect(nameMatches("  villa 12, the springs ", "Villa 12, The Springs")).toBe(true);
    expect(nameMatches("Villa 12", "Villa 12, The Springs")).toBe(false);
    expect(nameMatches("", "")).toBe(false);
    expect(await refused(softDeleteProject(db.client, "own", owner, "Villa 12"))).toMatchObject({ status: 422, code: "name_mismatch" });
  });
});

describe("a deleted project is not found everywhere", () => {
  it("every reference into it 404s; it leaves the member's list; membership reads false", async () => {
    await softDeleteProject(db.client, "own", owner, "Villa 12, The Springs");
    for (const refs of [{ project_id: "own" }, { plan_id: "pl-own" }, { room_id: "r-own" }, { boq_id: "bq1" }, { render_id: "rd1" }, { asset_id: "as1" }]) {
      expect(await refused(authorizeProject(db.client, owner, refs)), JSON.stringify(refs)).toMatchObject({ status: 404, code: "project_not_found" });
    }
    expect(await memberProjectIds(db.client, owner.id)).toEqual([]);
    expect(await isProjectMember(db.client, "own", owner.id)).toBe(false);
    // The preview of a deleted project is not found either.
    expect(await refused(deletePreview(db.client, "own", owner))).toMatchObject({ status: 404 });
  });
});

describe("restore round-trip", () => {
  it("restore brings it back exactly as it was — same members, same revisions", async () => {
    const before = JSON.stringify([db.tables.project_members, db.tables.boqs, db.tables.renders]);
    await softDeleteProject(db.client, "own", owner, "Villa 12, The Springs");
    const row = db.tables.projects!.find((p) => p.id === "own")!;
    expect(row.deleted_at).toBeTruthy();
    expect(row.deleted_by).toBe(owner.id);
    // Any member may restore (the helper could not delete it).
    await restoreProject(db.client, "own", helper);
    expect(row.deleted_at).toBeNull();
    expect(JSON.stringify([db.tables.project_members, db.tables.boqs, db.tables.renders])).toBe(before);
    expect(await authorizeProject(db.client, owner, { room_id: "r-own" })).toBe("own");
    expect(await refused(restoreProject(db.client, "own", owner))).toMatchObject({ status: 409, code: "not_deleted" });
  });

  it("Recently deleted lists it for its members, with who may delete it now", async () => {
    await softDeleteProject(db.client, "own", owner, "Villa 12, The Springs");
    const forOwner = await listRecentlyDeleted(db.client, owner);
    expect(forOwner).toHaveLength(1);
    expect(forOwner[0]).toMatchObject({ id: "own", name: "Villa 12, The Springs", deletedBy: "You", canDeleteNow: true });
    expect(Date.parse(forOwner[0]!.purgeOn) - Date.parse(forOwner[0]!.deletedAt)).toBe(30 * 24 * 3600 * 1000);
    expect((await listRecentlyDeleted(db.client, helper))[0]).toMatchObject({ canDeleteNow: false, deletedBy: "j.demo" });
    expect(await listRecentlyDeleted(db.client, stranger)).toEqual([]);
  });
});

describe("the confirm dialog's counts", () => {
  it("real counts, and the issued-proposal warning only when a proposal left", async () => {
    const own = await deletePreview(db.client, "own", owner);
    expect(own).toMatchObject({ name: "Villa 12, The Springs", counts: { revisions: 2, renders: 2, uploads: 2, proposals: 0 }, proposalIssued: false, packHref: null, permission: { allowed: true } });
    const frm = await deletePreview(db.client, "frm", member);
    expect(frm).toMatchObject({ name: "Townhouse 7, Al Barari", counts: { revisions: 1, proposals: 1 }, proposalIssued: true, packHref: "/project/frm/drawings#pack", permission: { allowed: false, reason: DELETE_REFUSED_FIRM } });
  });
});

describe("purge — rows and Storage", () => {
  it("the storage map covers every bucket a project writes to", () => {
    expect(projectStoragePrefixes("P").map((p) => `${p.bucket}:${p.prefix}`)).toEqual([
      "plan-uploads:P",
      "renders:projects/P",
      "packs:projects/P",
      "packs:downloads/P",
      "drawings:projects/P",
      "uploads:pending/plan/P",
      "uploads:pending/project_asset/P",
      "uploads:pending/room_photo/P",
    ]);
  });

  it("Delete now: only from Recently deleted, only for the deleting role, name again — removes the project's files and rows, nobody else's", async () => {
    expect(await refused(deleteNow(db.client, "own", owner, "Villa 12, The Springs"))).toMatchObject({ status: 409, code: "not_deleted" });
    await softDeleteProject(db.client, "own", owner, "Villa 12, The Springs");
    expect(await refused(deleteNow(db.client, "own", helper, "Villa 12, The Springs"))).toMatchObject({ status: 403 });
    expect(await refused(deleteNow(db.client, "own", owner, "wrong"))).toMatchObject({ status: 422 });
    const r = await deleteNow(db.client, "own", owner, "Villa 12, The Springs");
    expect(r.objects).toBe(9);
    expect(r.byBucket).toEqual({ "plan-uploads": 3, renders: 2, packs: 2, drawings: 1, uploads: 1 });
    const left = Object.fromEntries([...storage.buckets].map(([b, s]) => [b, [...s].sort()]));
    expect(left).toEqual({
      "plan-uploads": ["other/plan.pdf"],
      renders: ["projects/other/renders/x.png"],
      packs: ["projects/other/job/x.pdf"],
      drawings: [],
      uploads: ["pending/plan/other/u/def.pdf"],
    });
    expect(db.tables.projects!.map((p) => p.id).sort()).toEqual(["frm", "other"]);
  });

  it("the daily job purges only projects deleted more than 30 days ago, and dry-run removes nothing", async () => {
    const row = db.tables.projects!.find((p) => p.id === "own")!;
    row.deleted_at = "2026-09-01T00:00:00.000Z";
    const frm = db.tables.projects!.find((p) => p.id === "frm")!;
    frm.deleted_at = "2026-10-10T00:00:00.000Z"; // 3 days — stays
    const now = new Date("2026-10-13T00:00:00Z");
    const dry = await purgeExpiredProjects(db.client, { apply: false, now });
    expect(dry.projects.map((p) => [p.projectId, p.objects])).toEqual([["own", 9]]);
    expect(storage.buckets.get("plan-uploads")!.size).toBe(4);
    expect(db.tables.projects).toHaveLength(3);
    const wet = await purgeExpiredProjects(db.client, { apply: true, now });
    expect(wet.projects.map((p) => p.projectId)).toEqual(["own"]);
    expect(storage.buckets.get("plan-uploads")!.size).toBe(1);
    expect(db.tables.projects!.map((p) => p.id).sort()).toEqual(["frm", "other"]);
  });
});

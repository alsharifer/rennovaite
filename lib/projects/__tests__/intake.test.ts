import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/firms/__tests__/fake-db";

import { draftProjectRow, finishIntake, insertIntakeProject, intakeFields, sweepIntakeDrafts, withoutDrafts } from "../intake";

// K11 #1 (spec §7, migration 056) — the project an intake upload creates keeps
// the name the owner typed, is a draft until Continue, and an abandoned one is
// hidden and cleaned up after 24 h.

let db: FakeDb;
beforeEach(() => {
  db = fakeDb({ projects: [] });
});

describe("the upload path", () => {
  it("a typed name and city reach the project the upload creates — as a draft", async () => {
    const { id } = await insertIntakeProject(db.client, { name: "  Jumeirah   Parks Garden ", city: "Dubai" });
    const row = db.tables.projects!.find((p) => p.id === id)!;
    expect(row).toMatchObject({ name: "Jumeirah Parks Garden", city: "Dubai" });
    expect(row.draft_since).toEqual(expect.any(String));
  });

  it("nothing typed yet: the defaults, still a draft", () => {
    expect(draftProjectRow({}, new Date("2026-10-13T08:00:00Z"))).toEqual({ name: "Untitled", city: "Dubai", draft_since: "2026-10-13T08:00:00.000Z" });
    expect(intakeFields({ name: "   ", city: 7 })).toEqual({ name: null, city: null });
  });

  it("Continue writes the name the form holds NOW and ends the draft → the project shows the typed name", async () => {
    const { id } = await insertIntakeProject(db.client, {}); // uploaded before anything was typed
    expect(await withoutDrafts(db.client, [id])).toEqual([]); // hidden from Projects while a draft
    const out = await finishIntake(db.client, id, { name: "Jumeirah Parks Garden", city: "Abu Dhabi" });
    expect(out).toEqual({ name: "Jumeirah Parks Garden", city: "Abu Dhabi" });
    expect(db.tables.projects!.find((p) => p.id === id)).toMatchObject({ name: "Jumeirah Parks Garden", city: "Abu Dhabi", draft_since: null });
    expect(await withoutDrafts(db.client, [id])).toEqual([id]);
  });

  it("a blank name on Continue keeps the one typed at upload; a display name is renamed in place", async () => {
    const { id } = await insertIntakeProject(db.client, { name: "Villa 7" });
    expect((await finishIntake(db.client, id, { name: "" })).name).toBe("Villa 7");
    db.tables.projects!.find((p) => p.id === id)!.display_name = "Client name";
    await finishIntake(db.client, id, { name: "Renamed" });
    expect(db.tables.projects!.find((p) => p.id === id)).toMatchObject({ name: "Villa 7", display_name: "Renamed" });
  });
});

describe("abandoned drafts", () => {
  it("are soft-deleted after 24 h — not before, and never a continued project", async () => {
    const now = new Date("2026-10-14T12:00:00Z");
    db.tables.projects!.push(
      { id: "old-draft", name: "Untitled", draft_since: "2026-10-13T11:00:00Z", deleted_at: null },
      { id: "new-draft", name: "Untitled", draft_since: "2026-10-14T01:00:00Z", deleted_at: null },
      { id: "kept", name: "Villa", draft_since: null, deleted_at: null },
    );
    expect(await sweepIntakeDrafts(db.client, { now })).toEqual(["old-draft"]);
    expect(db.tables.projects!.find((p) => p.id === "old-draft")!.deleted_at).toBe(now.toISOString());
    expect(db.tables.projects!.find((p) => p.id === "new-draft")!.deleted_at).toBeNull();
    expect(db.tables.projects!.find((p) => p.id === "kept")!.deleted_at).toBeNull();
    expect(await sweepIntakeDrafts(db.client, { now })).toEqual([]); // idempotent
  });
});

describe("the wiring (static)", () => {
  const ROOT = path.resolve(__dirname, "../../..");
  const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

  it("the plan completion creates the project through insertIntakeProject (no hard-coded Untitled)", () => {
    const src = read("lib/uploads/register.ts");
    expect(src).toMatch(/await insertIntakeProject\(db, f\)/);
    expect(src).not.toMatch(/name: "Untitled"/);
  });

  it("the intake sends the typed name with the upload and saves it on Continue", () => {
    const src = read("app/project/new/_components/villa-intake.tsx");
    expect(src).toMatch(/completeUpload<UploadResponse>\(path, "plan", \{ filename: file\.name, name: project\.name\.trim\(\) \|\| null, city: project\.city \}\)/);
    expect(src).toMatch(/fetch\(`\/api\/projects\/\$\{plan\.res\.project_id\}\/intake`/);
  });

  it("drafts are left out of Projects, the switcher and Recently deleted; the cron sweeps them", () => {
    expect(read("lib/projects/home-view.ts")).toMatch(/filter\(\(p\) => !p\.draft_since\)/);
    expect(read("lib/journey-facts.ts")).toMatch(/withoutDrafts\(db, await memberProjectIds\(db, caller\.id\)\)/);
    expect(read("lib/projects/lifecycle.ts")).toMatch(/filter\(\(p\) => !p\.draft_since\)/);
    expect(read("app/api/cron/projects-purge/route.ts")).toMatch(/await sweepIntakeDrafts\(/);
  });
});

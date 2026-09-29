import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type { Caller } from "@/lib/auth/caller";
import { createFirm } from "@/lib/firms/store";
import { fakeDb, type FakeDb } from "@/lib/firms/__tests__/fake-db";

import { regenerateAuthority, regenerateReadiness } from "../regenerate";

// H4 — who may store a new BoQ revision, and why a Regenerate control is grey.
// One answer (lib/boq/regenerate.ts) for the route, the pack export and the page.

const alice: Caller = { id: "00000000-0000-4000-8000-00000000a11c", email: "alice@firm-a.test" };
const bob: Caller = { id: "00000000-0000-4000-8000-000000000b0b", email: "bob@firm-b.test" };
const sq = (x: number, y: number, s = 1) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];

let db: FakeDb;
beforeEach(() => {
  db = fakeDb({
    projects: [{ id: "p1", name: "Villa", city: "Dubai", firm_id: null }],
    plans: [{ id: "pl1", project_id: "p1", total_area_m2: 120, parsed_json: {}, created_at: "2026-09-01T00:00:00Z" }],
    rooms: [
      { id: "r1", plan_id: "pl1", name_en: "Living", room_type: "living", area_m2: 40, polygon: sq(0, 0) },
      { id: "r2", plan_id: "pl1", name_en: "Bedroom", room_type: "bedroom", area_m2: 20, polygon: sq(2, 0) },
    ],
    boqs: [
      { id: "b1", project_id: "p1", total_aed: 100000, created_at: "2026-09-02T00:00:00Z" },
      { id: "b2", project_id: "p1", total_aed: 104000, created_at: "2026-09-03T00:00:00Z" },
    ],
    firm_members: [],
  });
});

describe("regenerateAuthority", () => {
  it("nobody signed in → unauthenticated", async () => {
    expect((await regenerateAuthority(db.client, "p1", null))?.code).toBe("unauthenticated");
  });

  it("a project with no firm: any signed-in account", async () => {
    expect(await regenerateAuthority(db.client, "p1", bob)).toBeNull();
  });

  it("a firm's project: its members only — a non-member is refused on membership grounds", async () => {
    const firm = await createFirm(db.client, { name: "Firm A" }, alice);
    db.tables.projects![0]!.firm_id = firm.id;
    expect(await regenerateAuthority(db.client, "p1", alice)).toBeNull();
    const b = await regenerateAuthority(db.client, "p1", bob);
    expect(b?.code).toBe("not_a_member");
    expect(b?.reason).toMatch(/only its members can regenerate/);
  });

  it("an unknown project → project_not_found", async () => {
    expect((await regenerateAuthority(db.client, "nope", alice))?.code).toBe("project_not_found");
  });
});

describe("regenerateReadiness", () => {
  it("ready, with the latest revision as the diff's `from`", async () => {
    const r = await regenerateReadiness(db.client, "p1", alice);
    expect(r).toMatchObject({ ok: true, block: null, previous: { id: "b2", total_aed: 104000 } });
  });

  it("names the plan refusal generation would answer with, and where to fix it", async () => {
    db.tables.rooms![1]!.polygon = sq(0.5, 0.5); // now overlaps the living room
    const r = await regenerateReadiness(db.client, "p1", alice);
    expect(r.ok).toBe(false);
    expect(r.block).toMatchObject({ code: "plan_has_overlaps", fix: { href: "/project/p1/plan" } });
    expect(r.block?.reason).toMatch(/2 rooms on the plan overlap/);

    db.tables.plans = [];
    expect((await regenerateReadiness(db.client, "p1", alice)).block?.code).toBe("no_plan");
  });

  it("membership is decided before the plan: a non-member sees why they cannot, not a plan problem", async () => {
    const firm = await createFirm(db.client, { name: "Firm A" }, alice);
    db.tables.projects![0]!.firm_id = firm.id;
    db.tables.plans = [];
    expect((await regenerateReadiness(db.client, "p1", bob)).block?.code).toBe("not_a_member");
  });
});

describe("the wiring (static)", () => {
  const ROOT = path.resolve(__dirname, "../../..");
  const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

  it("generate-boq enforces authority on every storing run, before anything is loaded or persisted", () => {
    const src = read("app/api/generate-boq/route.ts");
    const gate = src.indexOf("await regenerateAuthority(supabase, projectId, caller)");
    expect(gate).toBeGreaterThan(0);
    expect(src.slice(gate - 200, gate)).toMatch(/if \(!dryRun\) \{/);
    expect(gate).toBeLessThan(src.indexOf("await loadBoqInputs("));
    // The event names the superseded revision and the trigger; the response carries the diff's `from`.
    expect(src).toMatch(/previous_boq_id: opts\.previousBoqId \?\? null/);
    expect(src).toMatch(/previous_boq_id: previous\?\.id \?\? null/);
  });

  it("the pack export refuses up front with the same answer (it regenerates inside its job)", () => {
    expect(read("app/api/projects/[id]/pack-export/route.ts")).toMatch(/await regenerateAuthority\(db, projectId, caller\)/);
  });

  it("the page passes the server's answer in; the control posts trigger=regenerate and links the U4 diff", () => {
    expect(read("app/project/[id]/boq/page.tsx")).toMatch(/regenerateReadiness\(sb, id, await getCaller\(\)\)/);
    const ui = read("app/project/[id]/boq/_components/regenerate-boq.tsx");
    expect(ui).toMatch(/trigger: "regenerate"/);
    expect(ui).toMatch(/\/boq\/revisions\?from=\$\{result\.previousId\}&to=\$\{result\.boqId\}/);
    expect(ui).not.toMatch(/lucide-react/);
  });
});

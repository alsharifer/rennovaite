// C5 #3 — the persona invariant (K2): a project attached to a firm, opened by a
// member of that firm, works the FIRM journey — never "My home" / "Owner". A
// project with no firm works the owner journey, and that is what the reviewer's
// project (Jumeirah Parks Garden) is on production: firm_id null on 21 Oct, so
// its "My home · Owner" rail was correct for its data — see SPRINT_C_ROOT_CAUSE §C5.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Caller } from "@/lib/auth/caller";
import { fakeDb } from "@/lib/firms/__tests__/fake-db";
import { journeyPersona, railPersonaLabels, type JourneyPersona } from "@/lib/journey";
import { loadProjectJourney } from "@/lib/journey-facts";

import { ROOT } from "./helpers/import-graph";

const reviewer: Caller = { id: "00000000-0000-4000-8000-0000000000b1", email: "reviewer@firm.test" };
const F = "f0000000-0000-4000-8000-0000000000f1";

describe("the rule", () => {
  it("firm-attached + the caller in that firm → firm; anything else → owner", () => {
    expect(journeyPersona(F, [F])).toBe("firm");
    expect(journeyPersona(null, [F])).toBe("owner");
    expect(journeyPersona(undefined, [])).toBe("owner");
    expect(journeyPersona(F, [])).toBe("owner"); // refused by the invariant, never reachable
  });
  it("a firm persona never reads 'My home', 'Your homes', 'Your renovation' or 'Owner'", () => {
    for (const admin of [true, false]) {
      const l = railPersonaLabels("firm", { admin });
      expect(Object.values(l).join(" ")).not.toMatch(/My home|Your homes|Your renovation|Owner/);
    }
    expect(railPersonaLabels("owner")).toEqual({ switcher: "My home", projects: "Your homes", journey: "Your renovation", role: "Owner" });
  });
  it("the rail draws its persona words only from railPersonaLabels", () => {
    const src = readFileSync(path.join(ROOT, "components/blueprint/shell/JourneyRail.tsx"), "utf8");
    expect(src).not.toMatch(/"My home"|"Owner"|"Your homes"|"Your renovation"/);
    expect(src).toMatch(/railPersonaLabels\(ctx\.persona/);
  });
});

describe("a reviewer's project, loaded as the rail loads it", () => {
  const journey = async (firmId: string | null): Promise<JourneyPersona> => {
    const db = fakeDb({
      projects: [{ id: "p1", name: "Jumeirah Parks Garden", display_name: null, city: "Dubai", firm_id: firmId, created_by: reviewer.id }],
      project_members: [{ project_id: "p1", user_id: reviewer.id }],
      firms: [{ id: F, name: "Abdallah Renovation", created_by: reviewer.email }],
      firm_members: [{ firm_id: F, user_id: reviewer.id, role: "admin" }],
    });
    return (await loadProjectJourney(db.client, "p1", reviewer, [{ id: F, name: "Abdallah Renovation" }])).persona;
  };
  it("attached to the reviewer's firm → the firm journey", async () => {
    expect(await journey(F)).toBe("firm");
  });
  it("as it stands on production (no firm attached) → the owner journey", async () => {
    expect(await journey(null)).toBe("owner");
  });
});

describe("the rail carries only a firm name the page may show (pack identity scan)", () => {
  const G = "f0000000-0000-4000-8000-0000000000f2";
  const ctxFor = async (firmId: string | null) => {
    const { loadRailContext } = await import("@/lib/journey-facts");
    const db = fakeDb({
      projects: [{ id: "p1", name: "Mudon pilot villa", display_name: null, city: "Dubai", firm_id: firmId, created_by: reviewer.id }],
      project_members: [{ project_id: "p1", user_id: reviewer.id }],
      firms: [
        { id: F, name: "Abdallah Renovation", created_by: reviewer.email },
        { id: G, name: "Second Studio", created_by: reviewer.email },
      ],
      firm_members: [
        { firm_id: F, user_id: reviewer.id, role: "admin" },
        { firm_id: G, user_id: reviewer.id, role: "admin" },
      ],
    });
    return loadRailContext(db.client, "p1", reviewer);
  };
  it("an owner project: no firm in the payload, though the caller has two", async () => {
    const ctx = await ctxFor(null);
    expect(ctx.persona).toBe("owner");
    expect(JSON.stringify(ctx)).not.toMatch(/Abdallah Renovation|Second Studio/);
  });
  it("a firm project: its own firm only", async () => {
    const ctx = await ctxFor(F);
    expect(ctx.persona).toBe("firm");
    expect(ctx.firms.map((f) => f.name)).toEqual(["Abdallah Renovation"]);
    expect(JSON.stringify(ctx)).not.toMatch(/Second Studio/);
  });
});

describe("the not-found pages carry no firm name (Next embeds them in every page of their segment)", () => {
  it("withoutFirmNames drops every firm; both not-found pages ask for it", async () => {
    const { loadRailContextWithoutProject } = await import("@/lib/journey-facts");
    const db = fakeDb({ projects: [], project_members: [], firms: [{ id: F, name: "Abdallah Renovation", created_by: reviewer.email }], firm_members: [{ firm_id: F, user_id: reviewer.id, role: "admin" }] });
    expect(JSON.stringify(await loadRailContextWithoutProject(db.client, reviewer, { withoutFirmNames: true }))).not.toMatch(/Abdallah Renovation/);
    expect(JSON.stringify(await loadRailContextWithoutProject(db.client, reviewer))).toMatch(/Abdallah Renovation/); // /firms, /settings keep the switcher
    for (const f of ["app/not-found.tsx", "app/project/[id]/not-found.tsx"]) expect(readFileSync(path.join(ROOT, f), "utf8"), f).toMatch(/<AccountShell title="Not found" withoutFirmNames>/);
  });
});

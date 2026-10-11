import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { SOURCE_NOTE, arabellaPlanInput } from "@/lib/client-garden/arabella-reference";
import { fakeDb } from "@/lib/firms/__tests__/fake-db";
import { buildPlanGraph, type PlanGraph } from "@/lib/plan/geometry";

import { findWithheldIdentities, loadWithheldNames, withheldFirmNames } from "../curation";

// =============================================================================
// I4 — plan notes. A measurement taken by a firm records it in the note
// ("6 m to the end-of-pathway wall (<firm> site measurement …)"), and the plan
// page shipped those notes in its payload on a project that is not the firm's.
// A SEEDED firm (a name that exists nowhere in the codebase) is written into
// every plan free-text field; the plan page's payload and the plan editors' API
// rows must come out with no trace of it — while the firm's own project keeps
// it, and the stored rows never change.
// =============================================================================

const FIRM = { id: "f-seed", name: "Hollowmere Garden Works", display_name: "Hollowmere" };
const NAMES = [FIRM.name, FIRM.display_name];
const MEASURED = `position measured: 6 m to the end-of-pathway wall (${FIRM.name} site measurement, design session Sep 2026)`;

let graph: PlanGraph;
vi.mock("@/lib/plan/derive", () => ({ derivePlanGraph: vi.fn(async () => graph) }));

/** The Arabella reference garden with the seeded firm written into every note it carries. */
function seededGraph(projectId: string): PlanGraph {
  const p = arabellaPlanInput({});
  const rooms = p.rooms.map((r, i) => (i === 0 ? { ...r, derived_note: `${r.derived_note}; ${MEASURED}`, spec: { ...(r.spec ?? {}), measured: MEASURED, unmapped_measure: { value: 5.3, source: `${FIRM.display_name} design session Sep 2026` } } } : r));
  const elements = p.elements.map((e, i) => (i === 0 ? { ...e, derived_note: `${SOURCE_NOTE}; ${MEASURED}`, spec: { ...(e.spec ?? {}), name: `Stepping path (${FIRM.display_name} survey)` } } : e));
  const context = p.context.map((c) => (c.id === "c-wall-separator" ? { ...c, note: MEASURED } : c));
  return buildPlanGraph({
    projectId,
    planId: "plan-1",
    scale: null,
    total_area_m2: 0,
    rooms,
    elements,
    context,
    unit_to_m: p.plot.width_m,
    plot: p.plot,
    plot_dims_derived: true,
    dims_note: `plot derived; front border measured by ${FIRM.name}`,
    source: "user_drawn",
  });
}

function seededDb() {
  return fakeDb({
    firms: [FIRM, { id: "f-other", name: "Quillfield Fitout", display_name: null }],
    projects: [{ id: "p-client", firm_id: null }, { id: "p-own", firm_id: FIRM.id }],
    plan_fixtures: [
      { id: "fx-1", project_id: "p-client", type: "tree", position: [0.5, 0.5], room_id: null, spec: { name: "Existing tree", assumption: `kept per ${FIRM.name}` }, site_reference: true, disposition: "keep", dims_derived: true, derived_note: MEASURED },
    ],
    plan_elements: [],
  });
}

describe("I4 — plan notes are curated on their way to a user", () => {
  beforeEach(() => {
    graph = seededGraph("p-client");
  });

  it("the plan page's garden payload carries no other firm's name — the separator wall's note included", async () => {
    const { loadGardenSiteData } = await import("@/lib/plan/garden-site-data");
    const db = seededDb();
    const data = await loadGardenSiteData(db.client, "p-client", "plan-1");

    const separator = data.items.find((i) => i.id === "c-wall-separator");
    expect(separator?.note).toContain("(contractor site measurement, design session Sep 2026)");
    // The seed really is in what the panel was built from …
    expect(findWithheldIdentities(JSON.stringify(graph), NAMES).length).toBeGreaterThan(0);
    // … and nowhere in what it sends (what the RSC payload serialises).
    expect(findWithheldIdentities(JSON.stringify(data), NAMES)).toEqual([]);
    // Ids, dispositions and geometry pass through untouched.
    expect(data.items.map((i) => i.id)).toContain("fx-1");
    expect(data.context.find((c) => c.id === "c-wall-separator")?.polygon).toEqual(
      expect.arrayContaining([expect.any(Array)]),
    );
  });

  it("a firm's own project keeps its name in the note", async () => {
    graph = seededGraph("p-own");
    const { loadGardenSiteData } = await import("@/lib/plan/garden-site-data");
    const data = await loadGardenSiteData(seededDb().client, "p-own", "plan-1");
    expect(data.items.find((i) => i.id === "c-wall-separator")?.note).toBe(MEASURED);
  });

  it("an API row's notes and spec strings are curated; names, ids and geometry are not", async () => {
    const { curatePlanRow } = await import("@/lib/plan/curate-notes");
    const names = await loadWithheldNames(seededDb().client, "p-client");
    const row = {
      id: "z-1",
      name_en: "Rear lawn",
      polygon: [[0, 0], [1, 0], [1, 1]],
      derived_note: MEASURED,
      note: MEASURED,
      name: `Separator wall (${FIRM.display_name})`,
      spec: { measured: MEASURED, unmapped_measure: { value: 5.3, source: `${FIRM.display_name} design session` }, posts_mm: [150, 150], form: "gazebo" },
    };
    const out = curatePlanRow(row, names);
    expect(findWithheldIdentities(out, NAMES)).toEqual([]);
    expect(out.id).toBe("z-1");
    expect(out.name_en).toBe("Rear lawn");
    expect(out.polygon).toEqual(row.polygon);
    expect(out.spec.posts_mm).toEqual([150, 150]);
    expect(out.spec.form).toBe("gazebo");
    expect(out.spec.unmapped_measure.value).toBe(5.3);
  });

  it("a firm is withheld by its display name too, not only its registered name", () => {
    expect(withheldFirmNames([FIRM], null)).toEqual([FIRM.name, FIRM.display_name]);
    expect(withheldFirmNames([{ id: "a", name: "Same Name", display_name: "Same Name" }], null)).toEqual(["Same Name"]);
    expect(withheldFirmNames([FIRM], FIRM.id)).toEqual([]);
  });
});

describe("I4 — curation never reaches the stored rows", () => {
  it("an editor re-sending the curated spec it read leaves the stored text alone, and keeps what it changed", async () => {
    const { curatePlanRow, keepStoredText } = await import("@/lib/plan/curate-notes");
    const db = seededDb();
    const names = await loadWithheldNames(db.client, "p-client");
    const stored = db.tables.plan_fixtures![0]!;
    const read = curatePlanRow(stored, names) as typeof stored & { spec: Record<string, unknown> };
    expect(findWithheldIdentities(read, NAMES)).toEqual([]);

    // The fixture inspector: `{ ...spec, ...draft }` plus the curated note.
    const patch: Record<string, unknown> = { spec: { ...read.spec, size_mm: 900 }, derived_note: read.derived_note };
    await keepStoredText(db.client, "plan_fixtures", "fx-1", patch, names);
    expect(patch).toEqual({ spec: { ...(stored.spec as object), size_mm: 900 }, derived_note: MEASURED });

    // A string the caller actually rewrote is kept as sent.
    const edited: Record<string, unknown> = { spec: { ...read.spec, assumption: "kept — confirmed on site" } };
    await keepStoredText(db.client, "plan_fixtures", "fx-1", edited, names);
    expect((edited.spec as Record<string, unknown>).assumption).toBe("kept — confirmed on site");
  });

  it("a patch with no free text reads nothing back", async () => {
    const { keepStoredText } = await import("@/lib/plan/curate-notes");
    const client = { from: vi.fn() };
    const patch = { disposition: "keep" };
    await keepStoredText(client as never, "plan_context", "c-1", patch, NAMES);
    expect(client.from).not.toHaveBeenCalled();
    expect(patch).toEqual({ disposition: "keep" });
  });
});

describe("I4 — every plan-text route curates what it returns (static)", () => {
  const ROUTES = ["plan-elements", "plan-context", "plan-fixtures", "plan-zones"];
  it.each(ROUTES)("app/api/%s returns no raw plan row", (r) => {
    const src = fs.readFileSync(path.join(process.cwd(), "app/api", r, "route.ts"), "utf8");
    expect(src).toMatch(/curatePlanRows?\(/);
    expect(src).toMatch(/keepStoredText\(/);
    // A row straight from the query (`data` / `existing`) under a row key is a leak.
    expect(src).not.toMatch(/NextResponse\.json\(\{\s*(elements?|context|fixtures?|zone):\s*(data|existing)\b/);
  });
});

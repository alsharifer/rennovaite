import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { fakeDb } from "@/lib/firms/__tests__/fake-db";
import { appendOverlaySections } from "@/lib/overlays/boq-feed";
import { buildPlanGraph, type BuildPlanGraphInput } from "@/lib/plan/geometry";
import { isInScope, isMultiLevelProject, netScopeChange, scopeChangeSummary, scopeSummary, stairsContextFor } from "@/lib/plan/scope";
import { renderLockProgress } from "@/lib/render-lock-progress";

import { generateDeterministicBoq } from "../engine";
import { boqIssues } from "../issues";
import { buildReviewModel } from "../review-model";
import { MUDON_FIRST_FLOOR } from "../fixtures/mudon-first-floor";
import { glazingOpeningsFrom } from "../glazing";
import { appendJoineryAluminumSections } from "../joinery-aluminum";
import { quantifyPlan } from "../quantify";
import { DEFAULT_FLOORING } from "../rules";
import { computeTakeoff } from "../takeoff";
import { chainTotals } from "../totals";
import { LABOUR_RATES_FIXTURE } from "./labour-rates.fixture";
import { PRICING_SKUS_FIXTURE } from "./pricing-skus.fixture";

// K12 (spec §7.4, migration 058) — rooms in this renovation. Removing a room
// removes exactly ITS room-level quantities; whole-home lines stay; the totals
// reconcile; putting it back restores the BoQ byte for byte.

/** Lines the engine emits once per project — kept whatever the scope (lib/plan/scope.ts says why). */
const WHOLE_HOME = new Set([
  "Q-05", // civil alterations allowance (1 project)
  "Q-11", // staircase renovation allowance (1 project — emitted even without a stairs room; flagged for a ruling)
  "Q-32", // site set-up
  "Q-33", // DM / DEWA permits — the approvals
  "Q-36", // scaffold
  "Q-37", // handover clean
]);

const qty = (rooms: typeof MUDON_FIRST_FLOOR) => Object.fromEntries(computeTakeoff(rooms, DEFAULT_FLOORING).items.map((i) => [`${i.rule_id}|${i.item_key}`, i.quantity]));

describe("the rules engine — exactly the room's quantities go", () => {
  for (const out of ["kids-bedroom-1", "kids-bathroom-2", "terrace"]) {
    it(`${out} out of scope: every room-level line drops by exactly that room's own quantity; whole-home lines stay`, () => {
      const all = qty(MUDON_FIRST_FLOOR);
      const scoped = qty(MUDON_FIRST_FLOOR.filter((r) => r.id !== out));
      const alone = qty(MUDON_FIRST_FLOOR.filter((r) => r.id === out));
      const keys = new Set([...Object.keys(all), ...Object.keys(scoped), ...Object.keys(alone)]);
      let moved = 0;
      for (const k of keys) {
        const rule = k.split("|")[0]!;
        const delta = (all[k] ?? 0) - (scoped[k] ?? 0);
        if (WHOLE_HOME.has(rule)) {
          expect(delta, `${k} is whole-home`).toBe(0);
          continue;
        }
        // Skips are area-driven but rounded UP (ceil(area × debris ÷ capacity)): the drop is
        // between 0 and the room's own count, never more.
        if (rule === "Q-34") {
          expect(delta).toBeGreaterThanOrEqual(0);
          expect(delta).toBeLessThanOrEqual(alone[k] ?? 0);
          continue;
        }
        expect(Math.abs(delta - (alone[k] ?? 0)), `${k}: Δ ${delta} vs the room alone ${alone[k] ?? 0}`).toBeLessThanOrEqual(0.011);
        if (delta !== 0) moved++;
      }
      expect(moved).toBeGreaterThan(0);
    });
  }
});

describe("the priced BoQ — totals reconcile; re-adding restores", () => {
  const price = (rooms: typeof MUDON_FIRST_FLOOR) => {
    const { boq } = generateDeterministicBoq({ rooms, labourRates: LABOUR_RATES_FIXTURE as never, skus: PRICING_SKUS_FIXTURE, styleKey: "contemporary-arabic" });
    return appendJoineryAluminumSections(boq, rooms.map((r) => ({ ...r, name_en: r.name })) as never);
  };

  it("leaving two rooms out lowers the subtotal, and every figure still adds up to the fil", () => {
    const all = price(MUDON_FIRST_FLOOR);
    const scoped = price(MUDON_FIRST_FLOOR.filter((r) => r.id !== "kids-bedroom-2" && r.id !== "terrace"));
    expect(scoped.subtotal_aed).toBeLessThan(all.subtotal_aed);
    for (const b of [all, scoped]) {
      const lines = b.sections.flatMap((s) => s.lines);
      expect(b.sections.every((s) => Math.round(s.lines.reduce((n, l) => n + l.total_aed, 0) * 100) === Math.round(s.section_total_aed * 100))).toBe(true);
      expect(Math.round(lines.reduce((n, l) => n + l.total_aed, 0) * 100)).toBe(Math.round(b.subtotal_aed * 100));
      const c = chainTotals({ subtotal_aed: b.subtotal_aed, contingency_pct: b.contingency_pct, vat_pct: b.vat_pct });
      expect([b.contingency_aed, b.vat_aed, b.grand_total_aed]).toEqual([c.contingency_aed, c.vat_aed, c.grand_total_aed]);
    }
    // Whole-home lines carry the same quantity and amount.
    const line = (b: typeof all, rule: string) => b.sections.flatMap((s) => s.lines).find((l) => (l.rule_id ?? "").startsWith(rule));
    for (const rule of ["Q-32", "Q-33", "Q-36", "Q-37"]) expect(line(scoped, rule)?.total_aed, rule).toBe(line(all, rule)?.total_aed);
  });

  it("putting the rooms back restores the BoQ byte for byte", () => {
    // engine.generated_at is the only field a second run may change (it is a timestamp).
    const stable = (b: ReturnType<typeof price>) => JSON.stringify({ ...b, engine: { ...(b as { engine?: object }).engine, generated_at: null } });
    const before = stable(price(MUDON_FIRST_FLOOR));
    void price(MUDON_FIRST_FLOOR.filter((r) => r.id !== "kids-bedroom-2"));
    expect(stable(price(MUDON_FIRST_FLOOR))).toBe(before);
  });

  it("joinery follows the rooms (wardrobes, doors); a bedroom out of scope leaves the bathrooms' glass and mirrors alone", () => {
    const all = price(MUDON_FIRST_FLOOR);
    const scoped = price(MUDON_FIRST_FLOOR.filter((r) => r.id !== "kids-bedroom-2"));
    const sec = (b: typeof all, name: string) => b.sections.find((s) => s.work_section === name);
    const alu = (b: typeof all) => sec(b, "Aluminum & Glass") ?? b.sections.find((s) => /alumin/i.test(s.work_section));
    expect(alu(scoped)?.section_total_aed).toBe(alu(all)?.section_total_aed);
    const joinery = (b: typeof all) => b.sections.find((s) => /joinery/i.test(s.work_section))?.section_total_aed ?? 0;
    expect(joinery(scoped)).toBeLessThan(joinery(all));
  });
});

describe("the element take-off (quantifyPlan) — per room, by room_id", () => {
  // Three rooms in a row on a 12 × 4 m strip: bed | bath | living (normalised x ∈ [0,1] → 12 m).
  const room = (id: string, room_type: string, x0: number, x1: number, in_scope?: boolean) => ({
    id,
    name_en: id,
    name_ar: null,
    room_type,
    area_m2: (x1 - x0) * 12 * 4,
    polygon: [
      [x0, 0],
      [x1, 0],
      [x1, 1 / 3],
      [x0, 1 / 3],
    ],
    ...(in_scope === undefined ? {} : { in_scope }),
  });
  const plan = (bathInScope?: boolean): BuildPlanGraphInput => ({
    projectId: "p",
    planId: "pl",
    scale: null,
    total_area_m2: 48,
    rooms: [room("bed", "bedroom", 0, 1 / 3), room("bath", "bathroom", 1 / 3, 2 / 3, bathInScope), room("living", "living", 2 / 3, 1)],
  });

  it("the bathroom out of scope: its floor, ceiling and tiling go; a wall goes only when no room beside it is in scope", () => {
    const all = quantifyPlan(buildPlanGraph(plan()));
    const scopedGraph = buildPlanGraph(plan(false));
    const scoped = quantifyPlan(scopedGraph);
    // The graph keeps the room (its scale and walls are unchanged).
    expect(scopedGraph.rooms.map((r) => r.id)).toEqual(buildPlanGraph(plan()).rooms.map((r) => r.id));
    expect(scopedGraph.rooms.find((r) => r.id === "bath")!.in_scope).toBe(false);
    // Room-level items of the bathroom: gone, all of them.
    const roomItems = (items: typeof all, id: string) => items.filter((i) => i.element_id === id);
    expect(roomItems(all, "bath").map((i) => i.work_item_key).sort()).toEqual(["ceiling_finish", "floor_finish", "wet_tiling"]);
    expect(roomItems(scoped, "bath")).toEqual([]);
    // Everything of the other rooms is untouched.
    for (const id of ["bed", "living"]) expect(roomItems(scoped, id)).toEqual(roomItems(all, id));
    // Walls: one bounded only by the bathroom is gone; one it shares is kept, on the in-scope neighbour.
    const walls = (items: typeof all) => items.filter((i) => i.work_item_key === "wall_plaster");
    const graph = buildPlanGraph(plan());
    const onlyBath = graph.walls.filter((w) => w.room_ids.length > 0 && w.room_ids.every((r) => r === "bath")).map((w) => w.id);
    const shared = graph.walls.filter((w) => w.room_ids.includes("bath") && w.room_ids.some((r) => r !== "bath")).map((w) => w.id);
    expect(onlyBath.length + shared.length).toBeGreaterThan(0);
    for (const id of onlyBath) expect(walls(scoped).some((w) => w.element_id === id)).toBe(false);
    for (const id of shared) expect(walls(scoped).find((w) => w.element_id === id)?.room_id).not.toBe("bath");
    expect(walls(all).length - walls(scoped).length).toBe(onlyBath.length);
  });

  it("back in scope → the identical take-off", () => {
    expect(quantifyPlan(buildPlanGraph(plan(true)))).toEqual(quantifyPlan(buildPlanGraph(plan())));
  });
});

describe("fixtures go with their room; whole-home ones stay", () => {
  it("a socket in a room left out is not priced; one placed in no room is", async () => {
    const db = fakeDb({
      plans: [{ id: "pl", project_id: "p", created_at: "2026-10-01T00:00:00Z" }],
      rooms: [
        { id: "r-in", plan_id: "pl", in_scope: true },
        { id: "r-out", plan_id: "pl", in_scope: false },
      ],
      plan_fixtures: [
        { id: "f1", project_id: "p", type: "socket_13a", room_id: "r-in" },
        { id: "f2", project_id: "p", type: "socket_13a", room_id: "r-out" },
        { id: "f3", project_id: "p", type: "socket_13a", room_id: null },
      ],
    });
    const base = { sections: [], subtotal_aed: 0, contingency_pct: 8, contingency_aed: 0, vat_pct: 5, vat_aed: 0, grand_total_aed: 0 };
    const out = (await appendOverlaySections(base as unknown as Parameters<typeof appendOverlaySections>[0], "p", db.client)) as unknown as { sections: { lines: { quantity: number }[] }[] };
    const qtyOf = out.sections.flatMap((s) => s.lines).reduce((n, l) => n + l.quantity, 0);
    expect(qtyOf).toBe(2);
  });
});

describe("renders and the summary follow the scope", () => {
  it("03 Renders counts only the rooms in this renovation", () => {
    const rooms = [
      { id: "a", room_type: "bedroom", in_scope: true },
      { id: "b", room_type: "bathroom", in_scope: false },
      { id: "c", room_type: "living", in_scope: true },
    ];
    expect(renderLockProgress(rooms.filter(isInScope), ["a"])).toEqual({ locked: 1, total: 2 });
  });

  it("the Overview's words, and the diff's cause from a window of edits", () => {
    expect(scopeSummary([...Array(11)].map(() => ({ in_scope: true })).concat([{ in_scope: false }, { in_scope: false }])).label).toBe("11 of 13 rooms in scope");
    expect(scopeChangeSummary(0, 2)).toBe("Scope: 2 rooms removed");
    expect(scopeChangeSummary(1, 2)).toBe("Scope: 1 room added, 2 rooms removed");
    // Out and back in again is no change; a removal that stays is.
    expect(netScopeChange([{ removed: ["t1", "t2"] }, { added: ["t1"] }])).toEqual({ added: [], removed: ["t2"] });
    expect(netScopeChange([{ added: ["x"] }, { removed: ["x"] }])).toEqual({ added: [], removed: [] });
  });
});

describe("the wiring (static)", () => {
  const ROOT = path.resolve(__dirname, "../../..");
  const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

  it("pricing, the timeline, renders and the summaries read the scope", () => {
    expect(read("lib/boq/assemble.ts")).toMatch(/const scoped = rooms\.filter\(\(r\) => !outOfScope\.has\(r\.id\)\);/);
    expect(read("lib/boq/quantify.ts")).toMatch(/if \(room\.in_scope === false\) continue;/);
    expect(read("lib/boq/garden-boq-feed.ts")).toMatch(/isOutdoorType\(r\.room_type\) && r\.in_scope !== false/);
    // C4: the timeline is THE programme of the latest BoQ — scoped when the BoQ is regenerated.
    expect(read("lib/timeline/load.ts")).toMatch(/programmeOf\(boqRow\.sections/);
    expect(read("app/project/[id]/render/page.tsx")).toMatch(/const roomList = \(rooms \?\? \[\]\)\.filter\(\(r\) => !outOfScope\.has\(r\.id\)\);/);
    expect(read("app/api/render/batch/route.ts")).toMatch(/filter\(\(r\) => !outOfScope\.has\(r\.id\)\)/);
    expect(read("app/api/render/route.ts")).toMatch(/room_not_in_scope/);
    expect(read("lib/journey-facts.ts")).toMatch(/filter\(\(r\) => !out\.has\(r\.id\)\)/);
    expect(read("lib/hub/overview-view.ts")).toMatch(/rooms in scope/);
    expect(read("lib/boq/revision-causes.ts")).toMatch(/kind: "scope_change"/);
  });
});

// K12 ruling (14 Oct) — Q-11 staircase renovation follows the scope.
describe("Q-11 staircase allowance", () => {
  const stairsRoom = { id: "stairs", name: "Stairs", room_type: "stairs", area_m2: 7.2, polygon: [[0, 0], [10, 0], [10, 20], [0, 20]] } as (typeof MUDON_FIRST_FLOOR)[number];
  const q11 = (rooms: typeof MUDON_FIRST_FLOOR, stairs?: { onPlan: boolean; multiLevel: boolean }) => computeTakeoff(rooms, DEFAULT_FLOORING, { stairs }).items.find((i) => i.rule_id === "Q-11");

  it("an in-scope stairs room → priced (measured)", () => {
    expect(q11([...MUDON_FIRST_FLOOR, stairsRoom], { onPlan: true, multiLevel: true })).toMatchObject({ quantity: 1 });
    expect(q11([...MUDON_FIRST_FLOOR, stairsRoom], { onPlan: true, multiLevel: true })?.qty_derived).toBeUndefined();
  });
  it("a stairs room left out of scope → no line", () => {
    expect(q11(MUDON_FIRST_FLOOR, { onPlan: true, multiLevel: true })).toBeUndefined();
  });
  it("no stairs room: a villa keeps it as an ASSUMED (derived) line; anything else gets none", () => {
    const v = q11(MUDON_FIRST_FLOOR, { onPlan: false, multiLevel: true });
    expect(v).toMatchObject({ quantity: 1, qty_derived: true });
    expect(v?.measurement).toMatch(/Staircase assumed — confirm the villa has stairs/);
    expect(q11(MUDON_FIRST_FLOOR, { onPlan: false, multiLevel: false })).toBeUndefined();
  });
  it("a plan typed in as ONE room is never multi-level — no staircase on a bathroom called \"Villa 12 — …\" (demo, 21 Oct)", () => {
    const bath = [{ room_type: "bathroom" }];
    const villaName = { name: "Villa 12 — guest bathroom" };
    expect(isMultiLevelProject(villaName)).toBe(true);
    expect(stairsContextFor(bath, villaName, "room_dimensions")).toEqual({ onPlan: false, multiLevel: false });
    expect(stairsContextFor(bath, villaName, null)).toEqual({ onPlan: false, multiLevel: true });
    expect(q11(MUDON_FIRST_FLOOR, stairsContextFor(bath, villaName, "room_dimensions"))).toBeUndefined();
  });
  it("no context (the timeline, pre-K12 callers) → the pre-K12 rule, unchanged", () => {
    expect(q11(MUDON_FIRST_FLOOR)).toMatchObject({ quantity: 1 });
    expect(q11(MUDON_FIRST_FLOOR)?.qty_derived).toBeUndefined();
  });
  it("the priced line reads derived, and the Issues navigator asks to confirm it", () => {
    const { boq } = generateDeterministicBoq({ rooms: MUDON_FIRST_FLOOR, labourRates: LABOUR_RATES_FIXTURE as never, skus: PRICING_SKUS_FIXTURE, styleKey: "contemporary-arabic", stairs: { onPlan: false, multiLevel: true } });
    const line = boq.sections.flatMap((s) => s.lines).find((l) => l.item_key === "stairs.renovation")!;
    expect(line.qty_derived).toBe(true);
    const model = buildReviewModel({ projectId: "p", boqId: "b", rev: 1, revDate: "", persona: "owner", boq: boq as never, provenance: null, tierCtx: { qsValidated: {} }, firm: null, basis: null, duplicates: [], budget: null });
    const issues = boqIssues(model, null);
    const g = issues.groups.find((x) => x.key === "assumed")!;
    expect(g.rows[0]).toMatchObject({ title: "Staircase assumed — confirm the villa has stairs", open: "line" });
    expect(issues.groups.find((x) => x.key === "derived")?.rows.some((r) => r.lineKey === g.rows[0]!.lineKey) ?? false).toBe(false);
  });
  it("villa / multi-level is read from the project's name until a property type exists", () => {
    expect(isMultiLevelProject({ name: "Villa 12, The Springs" })).toBe(true);
    expect(isMultiLevelProject({ name: "Untitled", display_name: "Arabian Ranches townhouse" })).toBe(true);
    expect(isMultiLevelProject({ name: "Marina apartment 1204" })).toBe(false);
  });
});

it("glazing follows the rooms in scope (C1 supersedes the 14 Oct whole-home allowance)", () => {
  // Two rooms, a window each on an outside wall; take one out of scope → its window goes with it.
  const graph = buildPlanGraph({
    projectId: "p", planId: "pl", scale: null, total_area_m2: 40,
    rooms: [
      { id: "a", name_en: "Living Room", name_ar: null, room_type: "living", area_m2: 20, polygon: [[0, 0], [5, 0], [5, 4], [0, 4]] },
      { id: "b", name_en: "Bedroom 2", name_ar: null, room_type: "bedroom", area_m2: 20, polygon: [[5, 0], [10, 0], [10, 4], [5, 4]] },
    ],
    openings: [
      { id: "w1", type: "window", width_mm: 1200, height_mm: 1500, position: [2.5, 0] },
      { id: "w2", type: "window", width_mm: 1000, height_mm: 1200, position: [7.5, 0] },
    ],
  } as unknown as BuildPlanGraphInput);
  const all = glazingOpeningsFrom(graph);
  expect(all.map((o) => o.id).sort()).toEqual(["w1", "w2"]);
  const scoped = glazingOpeningsFrom(graph, new Set(["a"]));
  expect(scoped.map((o) => [o.id, o.rooms.join("/")])).toEqual([["w1", "Living Room"]]);
});

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { generateDeterministicBoq } from "../engine";
import { MUDON_FIRST_FLOOR } from "../fixtures/mudon-first-floor";
import { lineIdentity, lineItemKey, stableLineKeys, stableRuleId } from "../line-identity";
import { diffRevisions, snapshotRevision, type DiffLine, type RecordedCause, type RevisionBoq } from "../revision-diff";
import { LABOUR_RATES_FIXTURE } from "./labour-rates.fixture";
import { PRICING_SKUS_FIXTURE } from "./pricing-skus.fixture";

// =============================================================================
// U4 — the revision diff. Three things are proven here:
//   1. the line identity is STABLE where the old change-report key was not;
//   2. classes, deltas, and causes attach only where a record names the line;
//   3. the diff REPRODUCES the Arabella G5d change report line for line — the
//      stage BoQs exported from the project (fixture) diffed pairwise give
//      exactly the moved lines, quantities and AED deltas the session script
//      recorded in screenshots/garden-pilot/g5d-session.json.
// =============================================================================

const boq = (sections: RevisionBoq["sections"], over: Partial<RevisionBoq> = {}): RevisionBoq => {
  const subtotal = sections.reduce((n, s) => n + s.section_total_aed, 0);
  return { sections, subtotal_aed: subtotal, contingency_pct: 0, contingency_aed: 0, vat_pct: 0, vat_aed: 0, grand_total_aed: subtotal, ...over };
};
const line = (description: string, quantity: number, rate_aed: number, extra: Record<string, unknown> = {}) => ({
  description,
  quantity,
  unit: "m2",
  rate_aed,
  total_aed: Math.round(quantity * rate_aed * 100) / 100,
  ...extra,
});
const section = (work_section: string, lines: ReturnType<typeof line>[]) => ({ work_section, lines, section_total_aed: lines.reduce((n, l) => n + l.total_aed, 0) });

describe("line identity", () => {
  it("prefers item_key, then the rule id's item, then the rule id without the engine suffix, then the description", () => {
    expect(lineIdentity({ description: "x", item_key: "garden.pcc_base", rule_id: "GL-04" })).toBe("garden.pcc_base");
    expect(lineIdentity({ description: "PCC base under paving", rule_id: "GL-04" })).toBe("garden.pcc_base"); // a pre-U4 garden line
    expect(lineIdentity({ description: "anything", rule_id: "P4/quantify/wall_plaster" })).toBe("wall_plaster");
    expect(lineIdentity({ description: "Soft strip — carpets, fixtures, fittings removal (no structural)", rule_id: "R-01/Labour" })).toBe("demo.soft_strip");
    expect(lineIdentity({ description: "Unknown thing", rule_id: "P2/overlay/socket" })).toBe("P2/overlay/socket");
    expect(lineIdentity({ description: "Free text" })).toBe("Free text");
    expect(stableRuleId("R-12/Catalogue")).toBe("R-12");
    expect(stableRuleId("GL-04")).toBe("GL-04");
    expect(lineItemKey({ description: "no rule" })).toBeNull();
  });

  it("does not move when an interior line's rate tier changes (the rule_id suffix does)", () => {
    const a = stableLineKeys([section("Demolition", [line("Soft strip", 10, 5, { rule_id: "R-01/Labour" })])]);
    const b = stableLineKeys([section("Demolition", [line("Soft strip", 10, 9, { rule_id: "R-01/Contractor rate book" })])]);
    expect(a["Demolition-0"]).toBe(b["Demolition-0"]);
  });

  it("numbers repeats within a section in order of appearance", () => {
    const k = stableLineKeys([section("Plumbing", [line("Tap", 1, 1, { rule_id: "GL-26" }), line("Tap", 1, 1, { rule_id: "GL-26" }), line("Free text", 1, 1)])]);
    expect(k["Plumbing-0"]).toBe("Plumbing|GL-26"); // an unknown GL label keys on its stable rule id
    expect(k["Plumbing-1"]).toBe("Plumbing|GL-26#2");
    expect(k["Plumbing-2"]).toBe("Plumbing|Free text");
  });

  it("every engine line carries item_key (the field the golden strips)", () => {
    const { boq: mudon } = generateDeterministicBoq({
      rooms: MUDON_FIRST_FLOOR,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      labourRates: LABOUR_RATES_FIXTURE as any,
      skus: PRICING_SKUS_FIXTURE,
      styleKey: "contemporary-majlis",
    });
    const lines = mudon.sections.flatMap((s) => s.lines);
    expect(lines.length).toBeGreaterThan(10);
    for (const l of lines) expect(l.item_key, l.description).toMatch(/^[a-z_]+\.[a-z0-9_]+$/);
    // And each line's identity equals its item key — the pre-U4 fallback names the same item.
    for (const l of lines) expect(lineItemKey({ description: l.description, rule_id: l.rule_id })).toBe(l.item_key);
  });
});

describe("diffRevisions", () => {
  const before = snapshotRevision("b1", "2026-09-01T10:00:00Z", boq([section("Hardscape & Structures", [line("PCC base under paving", 60, 100, { item_key: "garden.pcc_base" }), line("Paving install", 60, 70, { item_key: "garden.paving_install" })]), section("Soft Landscaping", [line("Grass", 80, 20, { item_key: "garden.grass_supply" })])], { garden: { draft: { draft: true } } }));
  const after = snapshotRevision("b2", "2026-09-02T10:00:00Z", boq([section("Hardscape & Structures", [line("PCC base under paving", 69, 100, { item_key: "garden.pcc_base" }), line("Paving install", 60, 75, { item_key: "garden.paving_install" }), line("Tile supply", 69, 128, { item_key: "garden.tile_supply" })]), section("Soft Landscaping", [line("Grass", 50, 22, { item_key: "garden.grass_supply" })]), section("Plumbing", [line("Drainage point", 2, 0, { item_key: "garden.drainage_point" })])], { garden: { draft: { draft: false } } }));

  it("classifies every movement and totals the deltas", () => {
    const d = diffRevisions(before, after);
    const by = Object.fromEntries(d.lines.map((l) => [l.item_key ?? "", l] as const)) as Record<string, DiffLine>;
    expect(by["garden.pcc_base"]).toMatchObject({ class: "quantity", delta_qty: 9, delta_pct: 15, delta_aed: 900 });
    expect(by["garden.paving_install"]).toMatchObject({ class: "rate", delta_qty: 0, delta_rate_aed: 5, delta_aed: 300 });
    expect(by["garden.grass_supply"]).toMatchObject({ class: "both", delta_qty: -30, delta_aed: 1100 - 1600 });
    expect(by["garden.tile_supply"]).toMatchObject({ class: "added", old: null, delta_aed: 8832 });
    expect(by["garden.drainage_point"]).toMatchObject({ class: "added", delta_aed: 0 });
    expect(d.unchanged).toBe(0);
    expect(d.counts).toEqual({ moved: 3, added: 2, removed: 0, with_cause: 0 });
    expect(d.summary.grand).toEqual({ old: 11800, new: 6900 + 4500 + 8832 + 1100, delta: r(6900 + 4500 + 8832 + 1100 - 11800) });
    expect(d.watermark_drops).toBe(true);
  });

  it("a removed line follows its section; the reverse diff mirrors it", () => {
    const d = diffRevisions(after, before);
    expect(d.lines.find((l) => l.item_key === "garden.tile_supply")).toMatchObject({ class: "removed", new: null, delta_aed: -8832 });
    expect(d.counts.removed).toBe(2);
    expect(d.watermark_drops).toBe(false);
  });

  it("attaches a cause ONLY to a line a record in the window names — never a story", () => {
    const recorded: RecordedCause[] = [
      { kind: "correction", at: "2026-09-01T12:00:00Z", summary: "quantity correction: PCC re-measured on site", item_keys: ["garden.pcc_base"] },
      { kind: "firm_rate", at: "2026-09-01T13:00:00Z", summary: "contractor rate book: paving install 75/m2", item_keys: ["garden.paving_install"] },
      { kind: "correction", at: "2026-08-30T12:00:00Z", summary: "before the window — must not attach", item_keys: ["garden.grass_supply"] },
      { kind: "correction", at: "2026-09-02T10:00:00Z", summary: "at the later revision's instant — attaches (from, to]", descriptions: ["Grass"] },
      { kind: "plan_edit", at: "2026-09-01T11:00:00Z", summary: "zones edited", },
      { kind: "regeneration", at: "2026-09-02T10:00:00Z", summary: "regenerated by the session script", revision_level: true },
    ];
    const d = diffRevisions(before, after, recorded);
    const by = Object.fromEntries(d.lines.map((l) => [l.item_key ?? "", l] as const)) as Record<string, DiffLine>;
    expect(by["garden.pcc_base"]!.causes.map((c) => c.kind)).toEqual(["correction"]);
    expect(by["garden.paving_install"]!.causes.map((c) => c.summary)).toEqual(["contractor rate book: paving install 75/m2"]);
    expect(by["garden.grass_supply"]!.causes.map((c) => c.summary)).toEqual(["at the later revision's instant — attaches (from, to]"]);
    expect(by["garden.tile_supply"]!.causes).toEqual([]); // nothing recorded → no cause, not "unknown"
    expect(d.window_causes.map((c) => c.kind)).toEqual(["plan_edit", "regeneration"]);
    expect(d.counts.with_cause).toBe(3);
  });

  it("identical revisions diff to nothing", () => {
    const d = diffRevisions(before, before);
    expect(d.lines).toEqual([]);
    expect(d.unchanged).toBe(3);
    expect(d.summary.grand.delta).toBe(0);
  });
});

const r = (n: number) => Math.round(n * 100) / 100;

// --- Arabella G5d reproduction ------------------------------------------------

interface SessionMoved {
  key: string;
  description: string;
  old_qty: number | null;
  new_qty: number | null;
  delta_aed: number;
  status: "moved" | "added" | "removed";
}
interface SessionRecord {
  stages: { label: string; boq_id: string; grand_total_aed: number }[];
  change_report: Record<string, { cause: string; boq: { old_total_aed: number; new_total_aed: number; delta_aed: number }; moved: SessionMoved[] }>;
  overall: { boq: { old_total_aed: number; new_total_aed: number; delta_aed: number } };
}
interface Fixture {
  project_id: string;
  stages: { label: string; boq_id: string; created_at: string; grand_total_aed: number }[];
  boqs: Record<string, RevisionBoq>;
}

describe("Arabella G5d change report, reproduced at line level", () => {
  const ROOT = path.resolve(__dirname, "../../..");
  const session = JSON.parse(fs.readFileSync(path.join(ROOT, "screenshots/garden-pilot/g5d-session.json"), "utf8")) as SessionRecord;
  const fx = JSON.parse(fs.readFileSync(path.join(ROOT, "lib/boq/__fixtures__/arabella-g5d-revisions.json"), "utf8")) as Fixture;
  const snap = (i: number) => {
    const s = fx.stages[i]!;
    return snapshotRevision(s.boq_id, s.created_at, fx.boqs[s.boq_id]!);
  };

  it("the fixture is the session's stage BoQs", () => {
    expect(fx.stages.map((s) => s.boq_id)).toEqual(session.stages.map((s) => s.boq_id));
    for (const s of fx.stages) expect(fx.boqs[s.boq_id]!.grand_total_aed).toBe(s.grand_total_aed);
    expect(fx.stages).toHaveLength(8);
    expect(JSON.stringify(fx)).not.toMatch(/Newspace|KAME|Atrium|Global Creation/i);
  });

  it.each(Object.keys(session.change_report))("stage %s → next: every moved line, old → new quantity and AED delta", (k) => {
    const i = Number(k);
    const expected = session.change_report[k]!;
    const d = diffRevisions(snap(i), snap(i + 1));
    expect(d.summary.grand).toEqual({ old: expected.boq.old_total_aed, new: expected.boq.new_total_aed, delta: expected.boq.delta_aed });
    const got = d.lines
      .map((l) => ({ description: l.description, old_qty: l.old?.quantity ?? null, new_qty: l.new?.quantity ?? null, delta_aed: l.delta_aed, status: l.class === "added" ? "added" : l.class === "removed" ? "removed" : "moved" }))
      .sort((a, b) => a.description.localeCompare(b.description));
    const want = expected.moved
      .map((m) => ({ description: m.description, old_qty: m.old_qty, new_qty: m.new_qty, delta_aed: m.delta_aed, status: m.status }))
      .sort((a, b) => a.description.localeCompare(b.description));
    expect(got).toEqual(want);
    // Every pre-U4 garden line keys on its ITEM (the session keys were section|GL-xx).
    for (const l of d.lines) expect(l.key).toMatch(/^[^|]+|garden./);
  });

  it("the whole session (baseline → the recorded end) matches the overall record and claims no cause it was not given", () => {
    // `overall` was recorded when the session script ran (baseline → its last stage, 5); the two later stages were added afterwards.
    const end = fx.stages.findIndex((s, i) => i > 0 && s.grand_total_aed === session.overall.boq.new_total_aed);
    const d = diffRevisions(snap(0), snap(end));
    expect(d.summary.grand).toEqual({ old: session.overall.boq.old_total_aed, new: session.overall.boq.new_total_aed, delta: session.overall.boq.delta_aed });
    expect(d.counts.with_cause).toBe(0); // no records handed in → no causes claimed
    // Causes WHERE RECORDED: the drainage-point line was added by a recorded fix stage.
    const recorded: RecordedCause[] = [
      { kind: "regeneration", at: fx.stages[6]!.created_at, summary: "G5d late fix stage (drainage points reach the take-off)", revision_level: true },
      { kind: "correction", at: "2026-09-19T04:57:38.296756+00:00", summary: "design correction recorded at the session", item_keys: ["garden.drainage_point"] },
    ];
    const withCauses = diffRevisions(snap(5), snap(6), recorded);
    expect(withCauses.lines).toHaveLength(1);
    expect(withCauses.lines[0]!.causes).toHaveLength(1);
    expect(withCauses.window_causes.map((c) => c.kind)).toEqual(["regeneration"]);
  });
});

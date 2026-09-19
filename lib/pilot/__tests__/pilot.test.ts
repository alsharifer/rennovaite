import { describe, expect, it } from "vitest";

import { changeReport, snapshotOf } from "@/lib/pilot/change-report";
import { computePilotMetrics, type PilotEvent } from "@/lib/pilot/events";
import { isVerdictless, judgePair, pairCacheKey, pairGatePrompt, pairManifest, pairPrompt, parsePairReply } from "@/lib/scene-render/photo-pair";
import { getGardenStyle } from "@/lib/garden-styles";

const ev = (kind: PilotEvent["kind"], at: string, detail: Record<string, unknown> = {}): PilotEvent => ({ kind, recorded_at: `2026-09-15T${at}:00.000Z`, detail });

describe("pilot metrics", () => {
  it("measures time to draw and time to the first FULL BoQ, and the gate pass rate", () => {
    const m = computePilotMetrics(
      [
        ev("plan_started", "08:50"),
        ev("plan_saved", "08:51", { stage: "reference_layout" }),
        ev("plan_saved", "09:20"),
        ev("design_edit", "10:10"),
        ev("boq_generated", "10:15", { full: false, needs_selection: 1 }),
        ev("boq_generated", "10:16", { full: true, stage: "verification" }),
        ev("design_edit", "10:30"),
        ev("boq_generated", "10:40", { full: true }),
        ev("design_edit", "11:30"),
        ev("friction", "10:05", { note: "could not reshape a run", area: "elements" }),
      ],
      [
        { view: "day", gate: { outcome: "passed", attempts: [{ passed: false }, { passed: true }] } },
        { view: "day", gate: { outcome: "substituted", attempts: [{ passed: false }, { passed: false }] } },
        { view: "evening", gate: { outcome: "passed", attempts: [{ passed: true }] } },
        { view: "day", gate: null },
      ],
      [{ correction_type: "rate" }, { correction_type: "rate" }, { correction_type: "scope" }],
    );
    // The designer: 09:20 → 10:30; active = only the gaps of 30 min or less (20).
    expect(m.time_to_draw_plan_min).toBe(70);
    expect(m.active_design_min).toBe(20);
    // From the project's first event to the first BoQ with nothing left open.
    expect(m.time_to_first_full_boq_min).toBe(110);
    expect(m.boq_generations).toBe(2);
    expect(m.render_gate).toEqual({ renders: 3, passed: 2, substituted: 1, pass_rate: 0.667, attempt_pass_rate: 0.4 });
    expect(m.friction).toEqual([{ at: "2026-09-15T10:05:00.000Z", note: "could not reshape a run", area: "elements" }]);
    expect(m.corrections).toEqual({ total: 3, by_type: { rate: 2, quantity: 0, scope: 1, design: 0 } });
  });
});

describe("the change-propagation receipt", () => {
  const boq = (grass: number, total: number) => ({
    grand_total_aed: total,
    sections: [
      { work_section: "Soft Landscaping", lines: [{ description: "Artificial grass", quantity: grass, unit: "m2", rate_aed: 26.4, total_aed: grass * 26.4, rule_id: "GL-07", qty_derived: true }] },
      { work_section: "Preliminaries", lines: [{ description: "Preliminaries", quantity: 1, unit: "lump", rate_aed: 3520, total_aed: 3520, rule_id: "GL-01" }] },
    ],
  });
  it("lists every quantity that moved, old → new, the BoQ delta, and whether the watermark drops", () => {
    const before = snapshotOf({ capturedAt: "t0", boqId: "b0", boq: boq(115.23, 10000), takeoff: [{ work_item_key: "garden.grass_supply", element_id: "z1", qty: 90.73, unit: "m2" }], draft: { draft: true, derived: ["plot boundary"] } });
    const after = snapshotOf({ capturedAt: "t1", boqId: "b1", boq: boq(131.03, 10500), takeoff: [{ work_item_key: "garden.grass_supply", element_id: "z1", qty: 106.53, unit: "m2" }], draft: { draft: false, derived: [] } });
    const r = changeReport(before, after);
    expect(r.moved).toHaveLength(1);
    expect(r.moved[0]).toMatchObject({ description: "Artificial grass", old_qty: 115.23, new_qty: 131.03, delta_qty: 15.8, status: "moved" });
    expect(r.unchanged).toBe(1);
    expect(r.element_rows_moved).toEqual([{ work_item_key: "garden.grass_supply", element_id: "z1", old_qty: 90.73, new_qty: 106.53 }]);
    expect(r.boq).toEqual({ old_total_aed: 10000, new_total_aed: 10500, delta_aed: 500, delta_pct: 5 });
    expect(r.draft.watermark_drops).toBe(true);
  });
});

describe("before/after photo pairs", () => {
  const m = pairManifest({ projectId: "arabella", assetId: "a1", zoneName: "Side garden — lawn", zoneSurface: "artificial grass lawn", items: [{ noun: "the gazebo", disposition: "keep" }, { noun: "the sink counter", disposition: "remove" }, { noun: "the planter border", disposition: "replace" }] });
  const good = { observations: [{ ref: "E1", present: true, roughly_in_place: true, note: "" }, { ref: "E2", present: false, roughly_in_place: false, note: "" }, { ref: "E3", present: true, roughly_in_place: true, note: "" }], house_unchanged: true, same_viewpoint: true, house_side_matches: true, visible_change: 2, extra_structures: [], summary: "" };

  it("passes only when kept items stay, removed items go, replaced items stay in place", () => {
    expect(judgePair(m, good).passed).toBe(true);
    expect(judgePair(m, { ...good, observations: good.observations.map((o) => (o.ref === "E2" ? { ...o, present: true } : o)) }).failures).toEqual(["the sink counter: should have been removed"]);
    expect(judgePair(m, { ...good, observations: good.observations.map((o) => (o.ref === "E1" ? { ...o, present: false } : o)) }).passed).toBe(false);
    expect(judgePair(m, { ...good, house_unchanged: false }).failures).toContain("house or boundary changed");
    expect(judgePair(m, { ...good, extra_structures: [{ description: "a pergola", major: true }] }).passed).toBe(false);
    expect(parsePairReply("looks lovely")).toBeNull();
  });

  it("parses the reply shapes models actually send, failing rather than going unavailable", () => {
    // The G5 draft run: extra_structures named its text field "what" — the whole reply was dropped.
    const reply = parsePairReply(JSON.stringify({ ...good, same_viewpoint: null, extra_structures: [{ what: "boundary wall with a gate", major: false }, { structure: "raised planter" }] }))!;
    expect(reply).not.toBeNull();
    expect(reply.extra_structures).toEqual([{ description: "boundary wall with a gate", major: false }, { description: "raised planter", major: true }]);
    expect(judgePair(m, reply).failures).toEqual(["viewpoint changed", "invented structure: raised planter"]);
  });

  it("fails a mirrored garden and an after that barely changes (G5c)", () => {
    expect(judgePair(m, { ...good, house_side_matches: false }).failures).toEqual(["orientation changed — the house is not on the same side as in the photo"]);
    expect(judgePair(m, { ...good, visible_change: 1 }).failures).toEqual(["too little visible change (1/3) — not a before/after"]);
    // A reply that does not answer the new questions fails on them, never passes silently.
    const legacy = parsePairReply(JSON.stringify({ observations: good.observations, house_unchanged: true, same_viewpoint: true, extra_structures: [], summary: "" }))!;
    expect(judgePair(m, legacy).passed).toBe(false);
  });

  it("never caches or trusts a withheld pair that got no verdict", () => {
    expect(isVerdictless([{ image_url: "", passed: false, failures: ["render error: fetch failed"] }, { image_url: "u2", passed: false, failures: ["gate unavailable: unparseable reply (…)"] }])).toBe(true);
    expect(isVerdictless([{ image_url: "u1", passed: false, failures: ["gate unavailable: x"] }, { image_url: "u2", passed: false, failures: ["viewpoint changed"] }])).toBe(false);
    expect(isVerdictless([])).toBe(false);
  });

  it("lets a replacement by a different element be larger than what it replaces", () => {
    const r = pairManifest({ projectId: "arabella", assetId: "a1", zoneName: "Terrace", zoneSurface: "porcelain paving", items: [{ noun: "the stepping-stone path", disposition: "replace", replacement: "porcelain paving" }] });
    expect(pairPrompt(r, getGardenStyle("desert-modern")!)).toContain("Replace the stepping-stone path with porcelain paving, where it stands now (the new work may be larger than what it replaces).");
    expect(pairGatePrompt(r)).toContain("its size follows the design, not the old item");
  });

  it("asks the model to change only what the design decided", () => {
    const p = pairPrompt(m, getGardenStyle("desert-modern")!);
    expect(p).toContain("Keep exactly as they are, same position and size: the gazebo");
    expect(p).toContain("Remove completely and fill their place with the surrounding garden surface: the sink counter");
    expect(p).toContain("Replace with new, clean versions of the same thing in exactly the same position and size: the planter border");
  });

  it("keys the cache by project first — the same photo decisions in another project never collide", () => {
    const other = { ...m, projectId: "villa-94" };
    expect(pairCacheKey(m, "desert-modern")).not.toBe(pairCacheKey(other, "desert-modern"));
    expect(pairCacheKey(m, "desert-modern")).not.toBe(pairCacheKey({ ...m, items: m.items.map((i) => ({ ...i, disposition: "keep" as const })) }, "desert-modern"));
    expect(() => pairCacheKey({ ...m, projectId: "" }, "desert-modern")).toThrow(/projectId is required/);
  });
});

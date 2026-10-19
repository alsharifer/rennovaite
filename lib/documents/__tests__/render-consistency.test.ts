import { describe, expect, it } from "vitest";

import { boqFixtureKinds, designKey, renderConsistency, type CurrentDesign, type ViewVersion } from "@/lib/documents/render-consistency";

// The pilot bathroom after the client's comments (19 Oct): the bidet is replaced
// by a storage cabinet, the BoQ prices a cabinet and no bidet.
const BOQ_LINES = [
  { rule_id: "P2/overlay/wc_point", quantity: 1 },
  { rule_id: "P2/overlay/basin_point", quantity: 1 },
  { rule_id: "P2/overlay/shower_mixer", quantity: 1 },
  { rule_id: "P2/overlay/floor_drain", quantity: 1 },
  { rule_id: "P2/overlay/shattaf_point", quantity: 1 },
  { rule_id: "W-25/R-66", item_key: "joinery.storage_cabinet", quantity: 1 },
];
const FIXTURES = [
  { id: "wc", type: "wc_point", spec: null },
  { id: "van", type: "basin_point", spec: null },
  { id: "sh", type: "shower_mixer", spec: null },
  { id: "cab", type: "storage_cabinet", spec: { replaces: "bidet_point", height_mm: 1200 } },
  { id: "sf", type: "shattaf_point", spec: null },
];
const CHOICES = { shower_screen: "fixed_panel", vanity: "ready_made" };
const CURRENT: CurrentDesign = {
  fixtures: boqFixtureKinds(BOQ_LINES),
  anchor: { render_id: "p2-v13", room_photo_id: "P2" },
  design_key: designKey(FIXTURES, CHOICES),
  revisions: ["2026-10-18T10:00:00Z", "2026-10-19T08:00:00Z"],
};
const AFTER_ITEMS = [{ kind: "door" }, { kind: "wc" }, { kind: "vanity" }, { kind: "shower" }, { kind: "cabinet" }, { kind: "bidet", gone: true }];
const BIDET_ERA = [{ kind: "door" }, { kind: "wc" }, { kind: "bidet" }, { kind: "vanity" }, { kind: "shower" }];
const view = (over: Partial<ViewVersion>): ViewVersion => ({ render_id: "r", created_at: "2026-10-19T09:00:00Z", items: AFTER_ITEMS, anchor_render_id: "p2-v13", follows: [{ element: "vanity", verdict: "yes" }], design_key: CURRENT.design_key, ...over });

describe("B7 1a — no pack ships a render that contradicts its BoQ", () => {
  it("the BoQ's fixtures: a cabinet, no bidet (the P2 points + the cabinet's joinery line)", () => {
    expect([...CURRENT.fixtures].sort()).toEqual(["cabinet", "shower", "vanity", "wc"]);
  });

  it("a render from before the swap — it still shows the bidet — is held back, the revision named", () => {
    const c = renderConsistency(view({ items: BIDET_ERA, created_at: "2026-10-18T12:00:00Z", design_key: null }), "P1", CURRENT);
    expect(c.ok).toBe(false);
    expect(c.ok ? "" : c.reason).toContain("has bidet");
    expect(c.ok ? "" : c.placeholder).toBe("View pending — design changed in rev 2");
  });

  it("a render that matches the fixtures, the current anchor and its finishes goes in", () => {
    expect(renderConsistency(view({}), "P4", CURRENT)).toEqual({ ok: true });
  });

  it("made against an earlier anchor → held back", () => {
    expect(renderConsistency(view({ anchor_render_id: "p2-v4" }), "P4", CURRENT).ok).toBe(false);
  });

  it("the anchor view shows only the anchor's current version", () => {
    expect(renderConsistency(view({ render_id: "p2-v13", anchor_render_id: null, follows: null }), "P2", CURRENT).ok).toBe(true);
    expect(renderConsistency(view({ render_id: "p2-v8", anchor_render_id: null, follows: null }), "P2", CURRENT).ok).toBe(false);
  });

  it("a finish read only 'partly' like the anchor (a hinged screen beside a fixed panel) → held back", () => {
    const c = renderConsistency(view({ follows: [{ element: "shower screen", verdict: "partly" }] }), "P4", CURRENT);
    expect(c.ok ? "" : c.reason).toContain("shower screen");
  });

  it("made before a product swap (its fingerprint differs) → held back", () => {
    const before = designKey(FIXTURES, { ...CHOICES, shower_screen: "enclosure" });
    expect(renderConsistency(view({ design_key: before }), "P4", CURRENT).ok).toBe(false);
  });

  it("the fingerprint ignores row and key order, and drops a fixture another one replaces", () => {
    const a = designKey([...FIXTURES].reverse(), { vanity: "ready_made", shower_screen: "fixed_panel" });
    expect(a).toBe(CURRENT.design_key);
    const withReplaced = designKey([...FIXTURES, { id: "bd", type: "bidet_point", spec: null }].map((f) => (f.id === "cab" ? { ...f, spec: { ...f.spec, replaces_fixture_id: "bd" } } : f)), CHOICES);
    expect(withReplaced).not.toContain("bidet_point,");
  });
});

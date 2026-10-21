// C5 #1 — every material a room's renders show is labelled from the B7 gate's
// own objects: illustrative · specified · priced · changed since render approval.
import { describe, expect, it } from "vitest";

import { designKey } from "@/lib/documents/render-consistency";

import { choicesOfKey, materialLabels } from "../material-labels";
import type { RoomDesignSpec } from "../room-spec-vocab";

const SPEC: RoomDesignSpec = {
  floor_tile: "large-format warm grey stone-look porcelain",
  wall_tile: "ivory 60 × 120 porcelain",
  tiled_height: "full height",
  vanity: "oak wall-hung vanity with an integrated ceramic basin",
  mirror: "round LED mirror",
  wc: "white floor-standing WC",
  shower_screen: "one fixed clear glass panel, brushed brass profile",
  fittings_finish: "brushed brass",
  palette: "warm neutrals",
};
const FIXTURES = [{ type: "wc_point", spec: null }, { type: "basin_point", spec: null }, { type: "shower_mixer", spec: null }];
const CHOICES = { shower_screen: "fixed_panel", shower_valve: "manual", vanity: "ready_made", fittings: "mid" };
const LINES = [
  { item_key: "joinery.vanity_ready", description: "Ready-made wall-hung vanity unit", rate_aed: 1474, quantity: 1 },
  { item_key: "alum.mirror_led_mid", description: "LED-lit mirror, mid-range", rate_aed: 900, quantity: 1 },
  { item_key: "san.wc_floor_mid", description: "Floor-standing close-coupled WC, mid-range", rate_aed: 1199, quantity: 1 },
  { item_key: "alum.shower_panel_fixed", description: "Fixed walk-in glass panel", rate_aed: 2139, quantity: 1 },
  { item_key: "san.shower_manual", description: "Concealed manual shower mixer", rate_aed: 1750, quantity: 1 },
  { rule_id: "P4/quantify/floor_finish", description: "Floor finish — supply & install", rate_aed: 190, quantity: 7, rate_tier: "catalog" },
  { rule_id: "P4/quantify/wet_tiling", description: "Wet-area wall tiling — supply & install", rate_aed: 260, quantity: 27.53, rate_tier: "catalog" },
];
const by = (rows: ReturnType<typeof materialLabels>) => Object.fromEntries(rows.map((r) => [r.field, r.label]));

describe("material labels", () => {
  it("the design fingerprint's product choices read back", () => {
    expect(choicesOfKey(designKey(FIXTURES, CHOICES))).toEqual(CHOICES);
  });

  it("approved with today's products: priced where the BoQ prices the product, illustrative where it prices only an allowance", () => {
    const rows = materialLabels({ spec: SPEC, choices: CHOICES, approvedKey: designKey(FIXTURES, CHOICES), lines: LINES });
    expect(by(rows)).toEqual({ floor_tile: "illustrative", wall_tile: "illustrative", vanity: "priced", mirror: "priced", wc: "priced", shower_screen: "priced", fittings_finish: "priced", palette: "illustrative" });
    expect(rows.find((r) => r.field === "floor_tile")!.why).toMatch(/tile allowance/);
  });

  it("a product change after the view was locked marks what it decides 'changed since render approval' — nothing else", () => {
    const approvedKey = designKey(FIXTURES, CHOICES);
    const now = { ...CHOICES, shower_screen: "enclosure" };
    const rows = materialLabels({ spec: SPEC, choices: now, approvedKey, lines: LINES });
    expect(by(rows).shower_screen).toBe("changed");
    expect(rows.find((r) => r.field === "shower_screen")!.why).toBe("shower screen was fixed_panel, now enclosure");
    expect(by(rows).vanity).toBe("priced");
    // No locked view → nothing approved → nothing "changed".
    expect(by(materialLabels({ spec: SPEC, choices: now, approvedKey: null, lines: LINES })).shower_screen).toBe("priced");
  });

  it("chosen but still to be priced = specified; a tile chosen on the Specification is priced", () => {
    const rows = materialLabels({ spec: SPEC, choices: { ...CHOICES, basin_mount: "wall_hung" }, approvedKey: null, lines: [{ item_key: "san.basin_wall_hung", description: "Wall-hung basin — TBC", rate_aed: 0, rate_status: "needs_qs", quantity: 1 }, { rule_id: "P4/quantify/floor_finish", description: "Floor finish — Calacatta porcelain", rate_aed: 210, quantity: 7, rate_tier: "selection" }] });
    expect(by(rows).vanity).toBe("specified");
    expect(by(rows).floor_tile).toBe("priced");
  });
});

describe("a locked view after a product change", () => {
  it("says what moved since the view was approved; unchanged = null", async () => {
    const { approvalDrift } = await import("../material-labels");
    const approved = designKey(FIXTURES, CHOICES);
    expect(approvalDrift(approved, approved)).toBeNull();
    expect(approvalDrift(approved, designKey(FIXTURES, { ...CHOICES, shower_screen: "enclosure" }))).toBe("shower screen was fixed_panel, now enclosure");
    expect(approvalDrift(approved, designKey([...FIXTURES, { type: "shattaf_point", spec: null }], CHOICES))).toBe("fixtures changed on the plan (added shattaf_point)");
    expect(approvalDrift(null, approved)).toBeNull();
  });
});

describe("the Specification's items", () => {
  it("the same four labels: changed (its element moved after approval) · priced · specified · illustrative", async () => {
    const { specItemLabels } = await import("../material-labels");
    const out = specItemLabels({
      itemKeys: ["san.wc", "san.shower", "san.basin", "elec.point", "lighting.downlight"],
      lines: [...LINES, { item_key: "san.wc", description: "WC — supply & fix", rate_aed: 1199, quantity: 1 }, { item_key: "elec.point", description: "Power point", rate_aed: 0, rate_status: "needs_qs", quantity: 3 }],
      selected: ["san.basin"],
      changed: { fittings_finish: "shower valve was manual, now thermostatic" },
    });
    expect(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.label]))).toEqual({ "san.wc": "priced", "san.shower": "changed", "san.basin": "changed", "elec.point": "specified", "lighting.downlight": "illustrative" });
  });
});

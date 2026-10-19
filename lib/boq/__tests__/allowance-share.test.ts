import { describe, expect, it } from "vitest";

import { allowanceNeeds, allowanceShare } from "../allowance-share";
import { rateBasisOf } from "../rate-basis";
import { RATE_RULES } from "../rules";

// B9 — how much of a price rests on our own estimates, by value.
const L = (rule_id: string, item_key: string, quantity: number, total_aed: number, rate_tier = "allowance") => ({ rule_id, item_key, description: item_key, quantity, total_aed, rate_aed: total_aed / Math.max(1, quantity), rate_tier });

describe("B9 — allowance share by value", () => {
  it("is the AED of allowance lines over the base total, with the largest named", () => {
    const sections = [
      { lines: [L("W-01/R-49", "prelim.room_protection", 1, 2200), L("Q-35/R-37", "prelim.floor_protection", 7, 56), L("P4/quantify/wet_tiling", "wet_tiling", 27.53, 7157.8, "labour_book")] },
      { lines: [L("W-02", "prelim.room_noc", 1, 0, "unpriced"), L("W-12/R-10", "floor.skirting", 0, 0, "labour_book")] },
    ];
    const s = allowanceShare(sections, 1);
    expect(s.base_aed).toBe(9413.8);
    expect(s.allowance_aed).toBe(2256);
    expect(s.pct).toBe(24);
    expect(s.allowance_lines).toBe(2);
    expect(s.lines).toBe(4); // a zero-quantity line (the skirting) prices nothing; a line still to be priced counts
    expect(s.top).toEqual([expect.objectContaining({ item_key: "prelim.room_protection", total_aed: 2200, needs: allowanceNeeds("prelim.room_protection") })]);
  });

  it("says what each kind of allowance needs to become a rate", () => {
    expect(allowanceNeeds("prelim.room_protection")).toMatch(/labour rate for one room/);
    expect(allowanceNeeds("joinery.vanity_ready")).toMatch(/supplier quote or a catalogue price/);
    expect(allowanceNeeds("plumb.heater_box")).toMatch(/labour rate for the trade/);
  });

  it("the five converted rules are sourced, not allowances — the source named by role, never by vendor", () => {
    const converted = { "alum.shower_panel_fixed": "catalogue", "san.shower_manual": "calibrated", "joinery.vanity_ready": "catalogue", "san.basin_mixer_mid": "calibrated", "san.wc_floor_mid": "catalogue" } as const;
    for (const [key, basis] of Object.entries(converted)) {
      const r = RATE_RULES[key]!;
      expect(r.sourced?.basis, key).toBe(basis);
      expect(rateBasisOf({ rule_id: `X/${r.rule_id}`, rate_tier: basis === "catalogue" ? "catalog" : "allowance" }), key).toBe(basis);
      expect(r.allowance_note, key).not.toMatch(/laspinas|danube|milano|rak ceramics/i);
    }
    // An allowance that was not converted stays one.
    expect(rateBasisOf({ rule_id: "W-01/R-49", rate_tier: "allowance" })).toBe("allowance");
  });
});

describe("B9 — one order of rate bases", () => {
  it("lists every basis, so no summary drops one (the BoQ page lost the catalogue lines before it)", async () => {
    const { RATE_BASIS_LABEL, RATE_BASIS_ORDER } = await import("../rate-basis");
    expect([...RATE_BASIS_ORDER].sort()).toEqual(Object.keys(RATE_BASIS_LABEL).sort());
  });
});

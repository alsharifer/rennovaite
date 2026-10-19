// B5 — the wet-room package, on the room sheet's bathroom (266 × 263 × 280, door S,
// window W, shower NE, WC + bidet on the W wall, vanity in the SE corner).
import { describe, expect, it } from "vitest";

import { applyElementMapping } from "@/lib/boq/element-map";
import { generateDeterministicBoq, priceScopeItem } from "@/lib/boq/engine";
import { appendJoineryAluminumSections } from "@/lib/boq/joinery-aluminum";
import { lineTotal, sumMoney } from "@/lib/boq/money";
import { quantifyPlan } from "@/lib/boq/quantify";
import { rateBasisOf } from "@/lib/boq/rate-basis";
import { RateResolver } from "@/lib/boq/rates";
import type { LabourRate, PricingSku } from "@/lib/boq/schema";
import { chainTotals } from "@/lib/boq/totals";
import { applyWetRoomPackage, footprintSides, priceOptions, wetRoomContextFrom } from "@/lib/boq/wet-room";
import { isUnpricedLine } from "@/lib/documents/boq-derived";
import { buildPlanGraph, type RawOpening } from "@/lib/plan/geometry";
import { roomFromDimensions } from "@/lib/plan/room-intake";

const L = 2.66;
const n = (xCm: number, yCm: number): [number, number] => [xCm / 100 / L, yCm / 100 / L];
const ROOM = roomFromDimensions({ room_type: "bathroom", length_m: 2.66, width_m: 2.63, height_m: 2.8 });
const RAW = { id: "bath", name_en: "Bathroom", name_ar: null, room_type: "bathroom", area_m2: ROOM.area_m2, polygon: ROOM.polygon, unroofed: false, ceiling_h_m: 2.8, ceiling_h_source: "measured", spec: { bulkhead: { over: "shower" } } };
const DOOR: RawOpening = { id: "door", room_id: "bath", type: "door", width_mm: 870, height_mm: 2100, sill_mm: 0, position: n((118 + 205) / 2, 263), derived: false };
const WINDOW: RawOpening = { id: "window", room_id: "bath", type: "window", width_mm: 450, height_mm: 600, sill_mm: 1500, position: n(0, (28 + 73) / 2), derived: false };
const graphOf = (room: Record<string, unknown> = RAW) =>
  buildPlanGraph({ projectId: "pilot", planId: "plan", scale: null, total_area_m2: ROOM.area_m2, rooms: [room as never], openings: [DOOR, WINDOW], unit_to_m: L, plot: { width_m: 2.66, depth_m: 2.63 }, source: "user_drawn" });

// The B1 fixtures as stored on dev (footprints entered, snapped to their walls).
const FIXTURES = [
  { id: "wc", type: "wc_point", room_id: "bath", position: n(33, 121), spec: { width_mm: 420, depth_mm: 660, rotation_deg: 90, footprint: "entered" } },
  { id: "bidet", type: "bidet_point", room_id: "bath", position: n(28, 212), spec: { width_mm: 360, depth_mm: 480, rotation_deg: 90, footprint: "entered", wall_gap_mm: 40 } },
  { id: "vanity", type: "basin_point", room_id: "bath", position: n(239, 219.5), spec: { width_mm: 870, depth_mm: 540, rotation_deg: 270, footprint: "entered" } },
  { id: "shower", type: "shower_mixer", room_id: "bath", position: n(195.5, 45.5), spec: { width_mm: 1410, depth_mm: 910, rotation_deg: 180, footprint: "entered" } },
  { id: "drain", type: "floor_drain", room_id: "bath", position: n(120, 110), spec: null },
  { id: "heater", type: "water_heater", room_id: "bath", position: n(170, 5), spec: { note: "~2.3 m over the shower" } },
] as { id: string; type: string; room_id: string; position: [number, number]; spec: Record<string, unknown> | null }[];

const lr = (work_section: string, description: string, unit: string, mid: number): LabourRate => ({ work_section, description, unit, rate_low_aed: mid, rate_mid_aed: mid, rate_high_aed: mid });
const LABOUR: LabourRate[] = [
  lr("Demolition", "Soft strip — carpets, fixtures, fittings removal (no structural)", "m2", 40),
  lr("Demolition", "Floor tile removal — intact substrate", "m2", 55),
  lr("Demolition", "Wall tile removal — bathroom", "m2", 70),
  lr("Plaster", "Internal skim or smoothing coat", "m2", 35),
  lr("Floor Finishes", "Floor screed 50mm", "m2", 60),
  lr("Floor Finishes", "Porcelain floor tiling — labour only", "m2", 70),
  lr("Floor Finishes", "Skirting installation (MDF or wood)", "lm", 55),
  lr("Wall Finishes", "Ceramic or porcelain wall tiling — bathroom, labour only", "m2", 85),
  lr("Decoration & Painting", "Internal painting — 2 coats over prepared surface", "m2", 30),
  lr("Electrical", "LED downlight — supply and install", "per fitting", 180),
  lr("Electrical", "Power socket or switch — supply and install", "per point", 140),
  lr("Plumbing", "Bathroom plumbing rewire — per bathroom, full", "per bathroom", 7500),
  lr("Plumbing", "Concealed water heater — supply and install", "per unit", 2800),
  lr("Plumbing", "Floor drain — supply and install", "per item", 650),
  lr("Sanitaryware", "WC suite supply and install — mid-range", "per item", 2400),
  lr("Sanitaryware", "Wash basin with mixer — supply and install", "per item", 1800),
  lr("Sanitaryware", "Shower system — mixer, handset, rain head", "per set", 3500),
  lr("Sanitaryware", "Bathtub — supply and install", "per item", 5500),
  lr("Joinery & Carpentry", "Vanity cabinet with quartz top — bathroom", "per unit", 7000),
  lr("Joinery & Carpentry", "Flush internal door — supply and fit", "per door", 2400),
  lr("Preliminaries", "Site setup, protection, daily clean — residential first-floor refit", "per project", 12000),
  lr("Preliminaries", "Permit and DM/DEWA fees — typical first-floor refit", "per project", 6000),
  lr("Preliminaries", "Skip hire and waste disposal", "per skip", 1500),
];
const SKUS: PricingSku[] = [{ sku: "T1", brand: "X", category: "Tiles", subcategory: "Marble Effect Porcelain", description_en: "porcelain", unit: "m2", price_aed: 90, vendor: "v" }];

function pilotBoq(room: Record<string, unknown> = RAW, fixtures: typeof FIXTURES = FIXTURES) {
  const graph = graphOf(room);
  const items = quantifyPlan(graph).filter((i) => i.work_item_key !== "ceiling_finish");
  const { boq } = generateDeterministicBoq({ rooms: [{ id: "bath", name: "Bathroom", room_type: "bathroom", area_m2: 7, polygon: ROOM.polygon, ceiling_h_m: 2.8 }], labourRates: LABOUR, skus: SKUS, styleKey: null });
  const mapped = applyElementMapping(boq, items);
  const joined = appendJoineryAluminumSections(mapped, [{ room_type: "bathroom", area_m2: 7 }]);
  // The P2 overlay as assemble appends it (the heater's TBC line included).
  joined.sections.push({ work_section: "Plumbing & Sanitary", lines: [{ description: "Electric water heater — supply & install", quantity: 1, unit: "no", rate_aed: 0, total_aed: 0, vendor_or_source: "TBC", notes: null, rule_id: "P2/overlay/water_heater", kind: "supply_and_install", rate_band: "allowance", wastage_pct: 0, rate_status: "needs_qs" } as never], section_total_aed: 0 } as never);
  const wallTile = items.filter((i) => i.work_item_key === "wet_tiling").reduce((s, i) => s + i.qty, 0);
  const ctx = wetRoomContextFrom(graph, "bath", fixtures, wallTile)!;
  const resolver = new RateResolver(LABOUR, SKUS, boq.engine.tier, {});
  const out = priceOptions(applyWetRoomPackage(joined as never, ctx, (item) => priceScopeItem(item, resolver)) as never) as ReturnType<typeof applyWetRoomPackage>;
  return { out, ctx, items };
}

const lines = (doc: { sections: { work_section: string; lines: Record<string, unknown>[] }[] }) => doc.sections.flatMap((s) => s.lines.map((l) => ({ ...l, section: s.work_section }))) as unknown as { section: string; rule_id?: string; item_key?: string; description: string; quantity: number; rate_aed: number; total_aed: number; rate_status?: string; rate_basis?: string; stated_zero?: boolean; confirm_on_site?: string }[];

describe("B5 — the painting rule (room sheet §7 item 7)", () => {
  it("full-height tiling: wall tiling 27.53 m², wall paint 0 (every wall is the bathroom's tiled face)", () => {
    const items = quantifyPlan(graphOf());
    const sum = (k: string) => Math.round(items.filter((i) => i.work_item_key === k).reduce((s, i) => s + i.qty, 0) * 100) / 100;
    expect(sum("wet_tiling")).toBe(27.53);
    expect(sum("wall_paint")).toBe(0);
    expect(Math.round(items.filter((i) => i.work_item_key === "wall_paint").reduce((s, i) => s + (i.tiled_m2 ?? 0), 0) * 100) / 100).toBe(27.52);
  });

  it("a 1.20 m dado moves both lines together: tiling below, paint above, openings split by band", () => {
    const items = quantifyPlan(graphOf({ ...RAW, tiled_height_m: 1.2 }));
    const sum = (k: string) => Math.round(items.filter((i) => i.work_item_key === k).reduce((s, i) => s + i.qty, 0) * 100) / 100;
    // Tiling: 10.58 × 1.20 − door 0.87 × 1.20 (the window's sill is 1.50 — above the band).
    expect(sum("wet_tiling")).toBeCloseTo(10.58 * 1.2 - 0.87 * 1.2, 1);
    // Paint: 10.58 × 1.60 − door 0.87 × 0.90 − window 0.45 × 0.60.
    expect(sum("wall_paint")).toBeCloseTo(10.58 * 1.6 - 0.87 * 0.9 - 0.45 * 0.6, 1);
  });
});

describe("B5 — the wet-room package on the pilot bathroom", () => {
  it("reads the shower's footprint against the walls: walls N 1.41 + E 0.91, glass on the two open sides", () => {
    const { ctx } = pilotBoq();
    const shower = ctx.fixtures.find((f) => f.type === "shower_mixer")!;
    expect(shower.onWall.sort()).toEqual([0.91, 1.41]);
    expect(shower.free.sort()).toEqual([0.91, 1.41]);
    expect(ctx.heater?.where).toMatch(/^N wall/);
    expect(ctx.door_widths_m).toBe(0.87);
  });

  it("takes out what does not belong to a one-bathroom, keep-the-layout job", () => {
    const all = lines(pilotBoq().out);
    const rules = all.map((l) => (l.rule_id ?? "").split("/")[0]);
    for (const gone of ["Q-05", "Q-19", "Q-20", "Q-22", "Q-24d", "Q-32", "Q-33", "Q-36", "Q-37", "S6-07"]) expect(rules).not.toContain(gone);
    expect(all.some((l) => (l.rule_id ?? "").startsWith("GT/aluminum/"))).toBe(false);
    expect(all.some((l) => ["GT/joinery/door_leaf", "GT/joinery/door_frame", "GT/joinery/bath_cabinet"].includes(l.rule_id ?? ""))).toBe(false);
    expect(all.some((l) => l.rule_id === "P2/overlay/water_heater")).toBe(false);
  });

  it("adds every wet-room section a QS expects, measured from the room", () => {
    const all = lines(pilotBoq().out);
    const by = (key: string) => all.filter((l) => l.item_key === key);
    expect(by("demo.wall_tile_removal")[0]!.quantity).toBe(27.53);
    expect(by("demo.floor_removal")[0]!.quantity).toBe(7);
    // Membrane: floor 7.00 + (10.58 − 0.87) × 0.15 = 8.46; shower walls (1.41 + 0.91) × 2.0 = 4.64.
    expect(by("wp.membrane").map((l) => l.quantity)).toEqual([8.46, 4.64]);
    expect(all.find((l) => l.section === "Waterproofing")).toBeTruthy();
    expect(by("floor.screed_wet")[0]!.quantity).toBe(7);
    expect(by("ceiling.repair")[0]!.confirm_on_site).toMatch(/leak/);
    expect(by("demo.ceiling_strip")[0]!.confirm_on_site).toBeUndefined();
    expect(by("san.wc_floor")).toHaveLength(1);
    expect(by("san.bidet")).toHaveLength(1);
    expect(by("alum.mirror_backlit")).toHaveLength(1);
    expect(by("elec.shaver")).toHaveLength(1);
    expect(by("elec.extractor")).toHaveLength(1);
    expect(by("wall.shower_niche")).toHaveLength(1);
    expect(by("light.led_strip")[0]!.quantity).toBe(2.32);
    expect(by("plumb.heater_box")[0]!.description).toMatch(/N wall/);
    expect(by("paint.full")[0]!.description).toMatch(/^Ceiling paint/);
    const glass = all.find((l) => (l.rule_id ?? "").startsWith("S6-06"))!;
    expect(glass.quantity).toBe(2);
  });

  it("states its zeros: no skirting (tiled from the floor), no wall paint (tiled to the ceiling)", () => {
    const all = lines(pilotBoq().out);
    const skirting = all.find((l) => l.item_key === "floor.skirting")!;
    const paint = all.find((l) => l.rule_id === "P4/quantify/wall_paint")!;
    for (const l of [skirting, paint]) {
      expect(l.total_aed).toBe(0);
      expect(l.stated_zero).toBe(true);
    }
  });

  it("every line multiplies out, sections and chain reconcile, the one TBC line is named not priced", () => {
    const { out } = pilotBoq();
    for (const s of out.sections) {
      for (const l of s.lines as { quantity: number; rate_aed: number; total_aed: number }[]) expect(l.total_aed).toBe(lineTotal(l.quantity, l.rate_aed));
      expect(s.section_total_aed).toBe(sumMoney((s.lines as { total_aed: number }[]).map((l) => l.total_aed)));
    }
    const c = chainTotals({ subtotal_aed: sumMoney(out.sections.map((s) => s.section_total_aed)), contingency_pct: out.contingency_pct, vat_pct: out.vat_pct });
    expect(out.grand_total_aed).toBe(c.grand_total_aed);
    const all = lines(out);
    const zero = all.filter((l) => l.total_aed === 0);
    expect(zero.every((l) => l.stated_zero || isUnpricedLine(l as never))).toBe(true);
    expect(all.filter((l) => isUnpricedLine(l as never)).map((l) => l.item_key)).toEqual(["prelim.room_noc"]);
  });

  it("every line says what its rate rests on — the Mudon lines calibrated", () => {
    const all = lines(pilotBoq().out);
    expect(all.every((l) => !!l.rate_basis)).toBe(true);
    expect(all.find((l) => l.item_key === "san.shattaf")!.rate_basis).toBe("calibrated");
    expect(all.find((l) => l.rule_id === "GT/joinery/vanity")!.rate_basis).toBe("calibrated");
    expect(all.find((l) => l.item_key === "demo.wall_tile_removal")!.rate_basis).toBe("market");
    expect(all.find((l) => l.item_key === "wp.membrane")!.rate_basis).toBe("allowance");
    expect(all.find((l) => l.item_key === "prelim.room_noc")!.rate_basis).toBe("tbc");
  });

  it("prices the options outside the total — net = adds − what they replace, the delta through the chain", () => {
    const { out } = pilotBoq();
    const wc = out.options.find((o) => o.key === "wall_hung_wc")!;
    expect(wc.adds.map((a) => a.item_key)).toEqual(["san.wc", "san.actuator", "san.wc_duct_wall"]);
    expect(wc.net_aed).toBe(2400 + 450 + 1200 - 1600);
    const bh = out.options.find((o) => o.key === "bulkhead_removal")!;
    expect(bh.net_aed).toBe(1100 - (197.2 + 104.4));
    for (const o of out.options) {
      const c = chainTotals({ subtotal_aed: out.subtotal_aed + o.net_aed, contingency_pct: out.contingency_pct, vat_pct: out.vat_pct });
      expect(o.delta_total_aed).toBeCloseTo(c.grand_total_aed - out.grand_total_aed, 2);
      // Never inside the total.
      expect(lines(out).some((l) => o.adds.some((a) => a.rule_id === l.rule_id))).toBe(false);
    }
  });
});

describe("B5 — footprint sides and rate basis", () => {
  it("a footprint side lies on a wall when both ends are within 6 cm of one edge", () => {
    const room: [number, number][] = [[0, 0], [2.66, 0], [2.66, 2.63], [0, 2.63]];
    const s = footprintSides([[1.25, 0], [2.66, 0], [2.66, 0.91], [1.25, 0.91]], room);
    expect(s.onWall.sort()).toEqual([0.91, 1.41]);
    expect(s.free.sort()).toEqual([0.91, 1.41]);
  });
  it("classifies a rate's basis", () => {
    expect(rateBasisOf({ rule_id: "Q-24a/R-40", rate_aed: 250, rate_tier: "allowance" })).toBe("calibrated");
    expect(rateBasisOf({ rule_id: "GT/aluminum/x", rate_aed: 9, rate_status: "site_assessment" })).toBe("allowance");
    expect(rateBasisOf({ rule_id: "Q-17/R-14", rate_aed: 180, rate_tier: "labour_book" })).toBe("market");
    expect(rateBasisOf({ rule_id: "W-02", rate_aed: 0, rate_status: "needs_qs" })).toBe("tbc");
    expect(rateBasisOf({ rule_id: "Q-17/R-14", rate_aed: 150, rate_tier: "firm_private" })).toBe("firm");
  });
});

describe("client comments (19 Oct) — a cabinet for the bidet, a shattaf beside the WC, the spec choices", () => {
  const CLIENT_FIXTURES = [
    ...FIXTURES.filter((f) => f.type !== "bidet_point"),
    { id: "cabinet", type: "storage_cabinet", room_id: "bath", position: n(28, 212), spec: { width_mm: 400, depth_mm: 450, rotation_deg: 90, replaces: "bidet_point" } },
    { id: "shattaf", type: "shattaf_point", room_id: "bath", position: n(2, 152), spec: null },
  ] as typeof FIXTURES;
  const CHOICES = { shower_screen: "fixed_panel", shower_valve: "manual", vanity: "ready_made", fittings: "mid", waste: "bagged", niche_led: false, existing_fixtures: "1 WC, 1 bidet, 1 basin + vanity, shower set" };
  const base = pilotBoq().out;
  const client = pilotBoq({ ...RAW, spec: { bulkhead: { over: "shower" }, wet_room: CHOICES } }, CLIENT_FIXTURES).out;
  const by = (doc: typeof base, rule: string) => lines(doc).filter((l) => (l.rule_id ?? "").split("/")[0] === rule);

  it("no bidet; a white storage cabinet as joinery; the existing bidet is still stripped out", () => {
    expect(by(client, "W-16")).toHaveLength(0);
    expect(by(client, "W-25")[0]).toMatchObject({ quantity: 1, rate_aed: 750, total_aed: 750, rate_basis: "allowance" });
    expect(by(client, "W-06")[0]!.description).toContain("existing sanitaryware (1 WC, 1 bidet, 1 basin + vanity, shower set)");
  });

  it("each choice is a different product at its own allowance — the base lines go, none is re-rated", () => {
    expect(by(client, "S6-06")).toHaveLength(0);
    expect(by(client, "W-26")[0]).toMatchObject({ quantity: 1, rate_aed: 2000 });
    expect(by(client, "Q-24")).toHaveLength(0);
    expect(by(client, "W-27")[0]).toMatchObject({ rate_aed: 2200 });
    expect(lines(client).some((l) => l.rule_id === "GT/joinery/vanity" || (l.rule_id ?? "").startsWith("S6-05"))).toBe(false);
    expect(by(client, "W-28")[0]).toMatchObject({ rate_aed: 2000 });
    expect(by(client, "Q-23")).toHaveLength(0);
    expect(by(client, "W-29")[0]!.description).toContain("on the vanity's own basin");
    expect(by(client, "W-15")[0]).toMatchObject({ rate_aed: 1200 });
    expect(by(client, "W-18")[0]).toMatchObject({ rate_aed: 900 });
    expect(by(client, "W-13")[0]).toMatchObject({ rate_aed: 600 });
    expect(by(client, "Q-34")).toHaveLength(0);
    expect(by(client, "W-30")[0]).toMatchObject({ rate_aed: 600 });
    // Every line that stays keeps its rate.
    for (const l of lines(client)) {
      const was = lines(base).find((b) => b.rule_id === l.rule_id && b.description === l.description);
      if (was) expect(l.rate_aed).toBe(was.rate_aed);
    }
  });

  it("the subtotal moves by exactly the lines changed", () => {
    const gone = (rules: string[]) => sumMoney(lines(base).filter((l) => rules.includes((l.rule_id ?? "").split("/")[0]!) || (rules.includes("GT-vanity") && l.rule_id === "GT/joinery/vanity")).map((l) => l.total_aed));
    const removed = gone(["W-16", "S6-06", "Q-24", "S6-05", "Q-23", "W-15", "W-18", "W-13", "Q-34", "GT-vanity"]);
    const added = 750 + 2000 + 2200 + 2000 + 600 + 1200 + 900 + 600 + 600;
    expect(client.subtotal_aed).toBeCloseTo(base.subtotal_aed - removed + added, 2);
    const c = chainTotals({ subtotal_aed: client.subtotal_aed, contingency_pct: client.contingency_pct, vat_pct: client.vat_pct });
    expect(client.grand_total_aed).toBe(c.grand_total_aed);
  });

  it("no choices = the base case, byte for byte", () => {
    const strip = (d: typeof base) => JSON.stringify({ ...d, engine: { ...(d as unknown as { engine: object }).engine, generated_at: null } });
    expect(strip(pilotBoq({ ...RAW, spec: { bulkhead: { over: "shower" }, wet_room: {} } }).out)).toBe(strip(base));
  });
});

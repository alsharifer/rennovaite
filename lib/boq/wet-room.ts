// =============================================================================
// lib/boq/wet-room.ts — the wet-room package: one bathroom from its dimensions,
// priced as a bathroom refit (bathroom pilot B5). Pure.
//
// The interior engine prices a VILLA: per-bathroom lumps calibrated on Mudon
// (a full re-pipe, a concealed heater, a wall-hung WC), whole-home allowances
// (civil alterations, the aluminium & glazing package, doors), villa-sized
// preliminaries. And the element take-off, which rebuilds the six surface
// sections, measures no strip-out, screed, waterproofing or ceiling paint. For
// a project that IS one bathroom (plans.intake = 'room_dimensions', the room a
// bathroom / ensuite / powder room) that BoQ is wrong in both directions. This
// package lays a QS's wet-room scope over it (room sheet §3, §6, §7):
//
//   removes   what does not belong — whole-home allowances, villa prelims, the
//             re-pipe (no relocation: the P2 points are the reconnections), the
//             concealed-heater supply (the heater is kept: box-in allowance), the
//             wall-hung WC + actuator (an OPTION here), the bath cabinet and door
//             joinery (the door stays), the plain mirror, the new gypsum ceiling
//             (the existing one is repaired)
//   adds      strip-out (tiles, floor, sanitaryware, screen, ceiling finish),
//             waterproofing (floor + 150 mm upstand, shower walls to 2.0 m),
//             screed to falls, skirting 0 (stated), lit niche, ceiling repair
//             (allowance — leak cause unknown), floor-standing WC, bidet,
//             backlit mirror, shaver point, extractor, cove LED on the
//             bulkhead, heater box-in, ceiling paint
//   keeps     every measured surface line (floor + wall tiling at the room's
//             height, wall paint above the tiled height — 0, stated), the
//             market sanitaryware, the calibrated accessories and vanity
//   options   priced, OUTSIDE the total: wall-hung WC + concealed cistern;
//             bulkhead removal — each with its net and its delta incl. VAT
//
// Every added line prices through the engine's own resolver (priceScopeItem):
// the R-xx rule, its tier and provenance, a firm's own rate where it has one.
// A line no book can price is TBC at 0 (needs_qs) — named, never folded into
// the total, listed by the Issues navigator. Villas are untouched.
// =============================================================================

import { footprintCorners, footprintOf } from "@/lib/overlays/footprint";
import type { PlanGraph, Point } from "@/lib/plan/geometry";

import { lineTotal, money2, sumMoney } from "./money";
import { rateBasisOf } from "./rate-basis";
import type { BoqLine, PomiSection, ScopeItem } from "./schema";
import { chainTotals, rechain, type ChainedDoc } from "./totals";

export const WET_ROOM_PACKAGE = "b5-1";
export const WET_ROOM_TYPES = new Set(["bathroom", "ensuite", "powder"]);

/** Height waterproofing runs up the shower walls (m). */
export const SHOWER_WP_HEIGHT_M = 2.0;
/** The floor membrane's upstand at the walls (m). */
export const UPSTAND_M = 0.15;

export interface WetRoomFixture {
  id: string;
  type: string;
  /** Footprint sides that lie along a room wall (m). */
  onWall: number[];
  /** Footprint sides open to the room (m) — a shower's glass. */
  free: number[];
  width_m: number | null;
  note: string | null;
}

export interface WetRoomContext {
  room_id: string;
  room_name: string;
  floor_m2: number;
  perimeter_m: number;
  ceiling_m: number;
  tiled_m: number;
  /** Σ door / archway widths into the room (m) — no upstand across a doorway. */
  door_widths_m: number;
  /** The wall tiling the take-off measured (m²) — the existing tiling assumed to the same height. */
  wall_tile_m2: number;
  fixtures: WetRoomFixture[];
  /** A water heater placed on the plan (kept; boxed in or relocated). */
  heater: { id: string; where: string } | null;
  /** room spec: a bulkhead over the shower (kept by default; removal is an option). */
  bulkhead: boolean;
}

// --- the room, measured -------------------------------------------------------------------

const r2 = (n: number) => Math.round(n * 100) / 100;

function distToSeg(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}

/** Which footprint sides lie on a wall of the room (both ends within `tol` m of one edge). */
export function footprintSides(corners: readonly Point[], polygon: readonly Point[], tol = 0.06): { onWall: number[]; free: number[] } {
  const onWall: number[] = [], free: number[] = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!, b = corners[(i + 1) % corners.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let on = false;
    for (let j = 0; j < polygon.length && !on; j++) {
      const e1 = polygon[j]!, e2 = polygon[(j + 1) % polygon.length]!;
      on = distToSeg(a, e1, e2) <= tol && distToSeg(b, e1, e2) <= tol;
    }
    (on ? onWall : free).push(r2(len));
  }
  return { onWall, free };
}

/** Which wall of the room a point is nearest, in words ("N wall"). Plan up = N. */
function wallWord(p: Point, polygon: readonly Point[]): string {
  const xs = polygon.map((q) => q[0]), ys = polygon.map((q) => q[1]);
  const d = { N: Math.abs(p[1] - Math.min(...ys)), S: Math.abs(Math.max(...ys) - p[1]), W: Math.abs(p[0] - Math.min(...xs)), E: Math.abs(Math.max(...xs) - p[0]) };
  return `${(Object.entries(d).sort((a, b) => a[1] - b[1])[0]![0])} wall`;
}

/**
 * The context for one wet room: its measured surfaces from the plan graph, its
 * fixtures' footprints against its walls, its heater and bulkhead. Fixtures are
 * in the plan's normalised space (like rooms.polygon); the graph's meta maps them
 * to metres.
 */
export function wetRoomContextFrom(graph: PlanGraph, roomId: string, fixtures: readonly { id: string; type: string; room_id: string | null; position: [number, number]; spec: Record<string, unknown> | null }[], wallTileM2: number): WetRoomContext | null {
  const room = graph.rooms.find((r) => r.id === roomId);
  if (!room || !WET_ROOM_TYPES.has(room.type ?? "")) return null;
  const k = graph.meta.unit_to_m, o = graph.meta.norm_origin;
  const toM = (p: [number, number]): Point => [(p[0] - o[0]) * k, (p[1] - o[1]) * k];
  let perim = 0;
  for (let i = 0; i < room.polygon.length; i++) {
    const a = room.polygon[i]!, b = room.polygon[(i + 1) % room.polygon.length]!;
    perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const own = fixtures.filter((f) => f.room_id === roomId);
  const fx: WetRoomFixture[] = own
    .filter((f) => f.type !== "water_heater")
    .map((f) => {
      const fp = footprintOf(f.type, f.spec);
      const sides = fp ? footprintSides(footprintCorners(f.position, fp, k).map((p) => toM(p as [number, number])), room.polygon) : { onWall: [], free: [] };
      return { id: f.id, type: f.type, ...sides, width_m: fp ? r2(fp.width_mm / 1000) : null, note: typeof f.spec?.note === "string" ? f.spec.note : null };
    });
  const h = own.find((f) => f.type === "water_heater");
  const doors = graph.openings.filter((op) => (op.type === "door" || op.type === "archway") && (op.room_id === roomId || graph.walls.find((w) => w.id === op.wall_id)?.room_ids.includes(roomId)));
  const ceiling = room.ceiling_h_m || 2.9;
  const tiled = typeof room.tiled_height_m === "number" ? Math.min(room.tiled_height_m, ceiling) : ceiling;
  return {
    room_id: roomId,
    room_name: room.name_en,
    floor_m2: r2(room.area_m2),
    perimeter_m: r2(perim),
    ceiling_m: ceiling,
    tiled_m: tiled,
    door_widths_m: r2(doors.reduce((s, d) => s + (d.width_mm || 0) / 1000, 0)),
    wall_tile_m2: r2(wallTileM2),
    fixtures: fx,
    heater: h ? { id: h.id, where: `${wallWord(toM(h.position), room.polygon)}${typeof h.spec?.note === "string" ? ` — ${h.spec.note}` : ""}` } : null,
    bulkhead: room.spec?.bulkhead != null && room.spec.bulkhead !== false,
  };
}

// --- the package -------------------------------------------------------------------------------

export interface BoqOption {
  key: string;
  label: string;
  note: string;
  /** The lines the option adds (priced, with their work section). */
  adds: (BoqLine & { work_section: string })[];
  /** The base-case lines it replaces (they come out of the base if it is taken). */
  replaces: { description: string; rule_id: string; total_aed: number }[];
  /** adds − replaces, before OH&P, contingency and VAT. */
  net_aed: number;
  /** What taking it moves the grand total by — through the BoQ's own chain. Set by priceOptions. */
  delta_total_aed?: number;
}

interface LineLike extends Record<string, unknown> {
  rule_id?: string;
  item_key?: string;
  description: string;
  quantity: number;
  rate_aed: number;
  total_aed: number;
  rate_status?: string;
  rate_tier?: string;
}

interface DocLike extends ChainedDoc {
  sections: { work_section: string; lines: LineLike[]; section_total_aed: number }[];
}

const ruleOf = (l: LineLike) => (l.rule_id ?? "").split("/")[0]!;
const count = (ctx: WetRoomContext, type: string) => ctx.fixtures.filter((f) => f.type === type);

/**
 * Lay the wet-room package over an assembled BoQ. `price` is the engine's
 * priceScopeItem bound to the project's resolver.
 */
export function applyWetRoomPackage<T extends DocLike>(boq: T, ctx: WetRoomContext, price: (item: ScopeItem) => BoqLine): T & { options: BoqOption[]; wet_room: { package: string; room_id: string } } {
  const sections = new Map<string, LineLike[]>(boq.sections.map((s) => [s.work_section, [...s.lines]]));
  const take = (section: string) => sections.get(section) ?? sections.set(section, []).get(section)!;
  const remove = (section: string, pred: (l: LineLike) => boolean) => sections.set(section, take(section).filter((l) => !pred(l)));
  const edit = (section: string, pred: (l: LineLike) => boolean, patch: (l: LineLike) => Partial<LineLike>) => sections.set(section, take(section).map((l) => (pred(l) ? { ...l, ...patch(l) } : l)));
  const room = [ctx.room_id];
  const W = (rule_id: string, work_section: PomiSection, item_key: string, description: string, quantity: number, unit: string, measurement: string, extra: Partial<ScopeItem> & { element_refs?: string[]; stated_zero?: true; confirm_on_site?: string } = {}): LineLike => {
    const { element_refs, stated_zero, confirm_on_site, ...item } = extra;
    const line = price({ rule_id, work_section, item_key, description, quantity: r2(quantity), unit, measurement, ...item }) as unknown as LineLike;
    return { ...line, ...(element_refs ? { element_refs } : {}), ...(stated_zero ? { stated_zero } : {}), ...(confirm_on_site ? { confirm_on_site } : {}) };
  };
  const add = (section: string, line: LineLike) => take(section).push(line);
  const tbc = (rule_id: string, item_key: string, description: string, quantity: number, unit: string, why: string): LineLike => ({
    description, quantity, unit, rate_aed: 0, total_aed: 0, vendor_or_source: "TBC — QS to price", notes: why, rule_id, item_key, kind: "allowance", rate_band: "allowance", wastage_pct: 0, rate_status: "needs_qs", rate_tier: "unpriced",
  });

  const shower = count(ctx, "shower_mixer")[0] ?? null;
  const glassSides = shower ? shower.free.filter((s) => s > 0.3) : [];
  const showerWalls = shower ? shower.onWall.filter((s) => s > 0.3) : [];
  const wcs = count(ctx, "wc_point"), bidets = count(ctx, "bidet_point"), baths = count(ctx, "bath_point"), basins = count(ctx, "basin_point");
  const fixtureList = [wcs.length ? `${wcs.length} WC` : "", bidets.length ? `${bidets.length} bidet` : "", basins.length ? `${basins.length} basin + vanity` : "", baths.length ? `${baths.length} bath` : "", shower ? "shower set" : ""].filter(Boolean).join(", ");

  // --- Preliminaries: one room in an occupied home, not a floor refit.
  remove("Preliminaries", (l) => ["Q-32", "Q-33", "Q-36", "Q-37"].includes(ruleOf(l)));
  add("Preliminaries", W("W-01", "Preliminaries", "prelim.room_protection", "Protection of the access route + dust screens, daily clean — one room", 1, "project", "single-room package (R-49)", { element_refs: room }));
  add("Preliminaries", tbc("W-02", "prelim.room_noc", "Building management / community NOC for internal works", 1, "project", "B5 — a like-for-like bathroom refit with no structural or MEP relocation needs the community's NOC, not a DM permit; the fee varies by community. TBC — QS to price (R-50 has no figure)."));
  add("Preliminaries", W("W-03", "Preliminaries", "prelim.room_clean", "Final clean — the room and its access route", 1, "project", "single-room package (R-51)", { element_refs: room }));

  // --- Demolition & strip-out (the element take-off measures none of it).
  add("Demolition", W("W-04", "Demolition", "demo.wall_tile_removal", "Strip existing wall tiles to the tiled height, cart away", ctx.wall_tile_m2, "m2", `= the wall tiling measured (${ctx.wall_tile_m2} m²) — existing tiling assumed to the same height; confirm on site`, { element_refs: room }));
  add("Demolition", W("W-05", "Demolition", "demo.floor_removal", "Strip existing floor tiles and bed", ctx.floor_m2, "m2", `floor area ${ctx.floor_m2} m²`, { element_refs: room }));
  add("Demolition", W("W-06", "Demolition", "demo.soft_strip", `Strip out sanitaryware (${fixtureList || "fixtures"}), vanity top, mirror and accessories; isolate and cap services`, ctx.floor_m2, "m2", `soft strip by floor area ${ctx.floor_m2} m² (R-01)`, { element_refs: [...room, ...ctx.fixtures.map((f) => f.id)] }));
  if (glassSides.length) add("Demolition", W("W-07", "Demolition", "demo.shower_screen", "Take down the existing shower screen and its fixings", 1, "no", "one screen, replaced (R-52)", { element_refs: [shower!.id] }));
  add("Demolition", W("W-08", "Demolition", "demo.ceiling_strip", "Strip the damaged ceiling finish back to sound plaster", ctx.floor_m2, "m2", `ceiling = floor area ${ctx.floor_m2} m² (R-53)`, { element_refs: room, rate_status: "site_assessment" }));

  // --- Waterproofing.
  const upstand = r2(Math.max(0, ctx.perimeter_m - ctx.door_widths_m) * UPSTAND_M);
  add("Waterproofing", W("W-09", "Waterproofing", "wp.membrane", `Waterproofing membrane to the floor with a ${UPSTAND_M * 1000} mm upstand at the walls`, ctx.floor_m2 + upstand, "m2", `floor ${ctx.floor_m2} + upstand (${ctx.perimeter_m} − doors ${ctx.door_widths_m}) × ${UPSTAND_M} = ${r2(ctx.floor_m2 + upstand)} m²`, { element_refs: room }));
  if (showerWalls.length) {
    const len = r2(showerWalls.reduce((s, v) => s + v, 0));
    add("Waterproofing", W("W-10", "Waterproofing", "wp.membrane", `Waterproofing membrane to the shower walls to ${SHOWER_WP_HEIGHT_M.toFixed(1)} m`, len * SHOWER_WP_HEIGHT_M, "m2", `shower walls ${showerWalls.join(" + ")} = ${len} m × ${SHOWER_WP_HEIGHT_M} m (from the shower's footprint on the plan)`, { element_refs: [shower!.id] }));
  }

  // --- Floor finishes: screed to falls; skirting none (tiled walls) — stated.
  add("Floor Finishes", W("W-11", "Floor Finishes", "floor.screed_wet", "Screed 50 mm to falls to the drains", ctx.floor_m2, "m2", `floor area ${ctx.floor_m2} m²`, { element_refs: room }));
  add("Floor Finishes", { ...W("W-12", "Floor Finishes", "floor.skirting", "Skirting — none: the walls are tiled from the floor", 0, "lm", `walls tiled to ${ctx.tiled_m >= ctx.ceiling_m - 1e-9 ? "full height" : `${ctx.tiled_m.toFixed(2)} m`} — no skirting (R-10; F-04 takes no wet room)`), stated_zero: true });

  // --- Wall finishes: the lit niche.
  if (shower) add("Wall Finishes", W("W-13", "Wall Finishes", "wall.shower_niche", "Recessed shower niche with LED strip — formed, waterproofed, tiled", 1, "no", "one niche (R-56)", { element_refs: [shower.id] }));

  // --- Ceilings: the existing ceiling is repaired, not replaced.
  add("Ceilings", W("W-14", "Ceilings", "ceiling.repair", `Ceiling repair — fungicidal wash, stain-block, skim${ctx.bulkhead ? "; the curved bulkhead over the shower made good with it" : ""}. Allowance until the cause of the water damage is known`, ctx.floor_m2, "m2", `ceiling = floor area ${ctx.floor_m2} m² (R-54) — is the leak fixed?`, { element_refs: room, rate_status: "site_assessment", confirm_on_site: "Ceiling repair is an allowance until the cause of the water damage is known — is the leak fixed?" }));

  // --- Sanitaryware: floor-standing WC base case; bidet; basin + mixer; shower set.
  remove("Sanitaryware", (l) => ["Q-22", "Q-24d"].includes(ruleOf(l)));
  if (wcs.length) add("Sanitaryware", W("W-15", "Sanitaryware", "san.wc_floor", "Floor-standing close-coupled rimless WC — supply and install (existing position)", wcs.length, "no", `WC on the plan × ${wcs.length}`, { element_refs: wcs.map((f) => f.id) }));
  if (bidets.length) add("Sanitaryware", W("W-16", "Sanitaryware", "san.bidet", "Floor-standing bidet with mixer — supply and install (existing position)", bidets.length, "no", `bidet on the plan × ${bidets.length}`, { element_refs: bidets.map((f) => f.id) }));
  if (baths.length) add("Sanitaryware", W("W-17", "Sanitaryware", "san.bath", "Bath — supply and install", baths.length, "no", `bath on the plan × ${baths.length}`, { element_refs: baths.map((f) => f.id) }));
  edit("Sanitaryware", (l) => ruleOf(l) === "Q-23", () => ({ description: "Basin with mixer, brushed brass — supply and install (existing position)", element_refs: basins.map((f) => f.id) }));
  edit("Sanitaryware", (l) => ruleOf(l) === "Q-24", () => ({ description: "Thermostatic shower — concealed valve, rain head + hand shower, brushed brass (existing position)", ...(shower ? { element_refs: [shower.id] } : {}) }));
  if (!shower) remove("Sanitaryware", (l) => ruleOf(l) === "Q-24");
  if (!basins.length) remove("Sanitaryware", (l) => ruleOf(l) === "Q-23");

  // --- Joinery: a floating vanity with a stone top and an open shelf; the door stays.
  remove("Joinery", (l) => ["GT/joinery/bath_cabinet", "GT/joinery/door_leaf", "GT/joinery/door_frame"].includes(l.rule_id ?? ""));
  const vanity = basins[0];
  edit("Joinery", (l) => l.rule_id === "GT/joinery/vanity", () => ({ description: `Floating vanity, oak-tone, open towel shelf — supply and install${vanity?.width_m ? ` (${Math.round(vanity.width_m * 1000)} mm run, plan)` : ""}`, ...(vanity ? { element_refs: [vanity.id] } : {}) }));
  edit("Joinery", (l) => ruleOf(l) === "S6-05", () => ({ description: "Stone vanity top with undermount cut-out — allowance, requires site measurement" }));
  if (!basins.length) remove("Joinery", (l) => l.rule_id === "GT/joinery/vanity" || ruleOf(l) === "S6-05");

  // --- Glass + mirror: no whole-home aluminium; the shower's own glass; a backlit mirror.
  remove("Aluminum & Glass", (l) => (l.rule_id ?? "").startsWith("GT/aluminum/") || ruleOf(l) === "S6-07");
  if (glassSides.length) {
    edit("Aluminum & Glass", (l) => ruleOf(l) === "S6-06", (l) => ({ description: `Frameless clear glass enclosure — ${glassSides.length === 1 ? "one panel with door" : `${glassSides.length} panels incl. hinged door`}, brushed-brass fittings (${glassSides.map((s) => s.toFixed(2)).join(" + ")} m)`, quantity: glassSides.length, total_aed: lineTotal(glassSides.length, l.rate_aed), notes: `${String(l.notes ?? "")}; sides of the shower's footprint open to the room, from the plan`.replace(/^; /, ""), element_refs: [shower!.id] }));
  } else remove("Aluminum & Glass", (l) => ruleOf(l) === "S6-06");
  if (basins.length) add("Aluminum & Glass", W("W-18", "Aluminum & Glass" as PomiSection, "alum.mirror_backlit", "Backlit LED mirror, round or pill, demister — supply and install", 1, "no", "one mirror over the vanity (R-59)", { element_refs: basins.map((f) => f.id) }));

  // --- The skim line on tiled walls is substrate preparation, not a paint finish; the
  // calibrated accessories carry the design's finish (their rate is the reference's).
  edit("Plaster", (l) => l.rule_id === "P4/quantify/wall_plaster", () => ({ description: "Wall substrate — make good after tile removal and level to receive the membrane and tiles (net of openings)" }));
  edit("Sanitaryware", (l) => ["Q-24a", "Q-24b", "Q-24c"].includes(ruleOf(l)), (l) => ({ description: l.description.replace("matt black", "brushed brass"), notes: `${String(l.notes ?? "")}; finish per the design — the rate is the reference villa's matt black`.replace(/^; /, "") }));

  // --- Electrical: wet-rated lights, the spurs, a shaver point, an extractor.
  edit("Electrical", (l) => ruleOf(l) === "Q-17", () => ({ description: "LED downlights, IP65 — supply and install" }));
  edit("Electrical", (l) => ruleOf(l) === "Q-18", () => ({ description: "Switches and switched spurs (lights, cove, mirror backlight) — supply and install" }));
  add("Electrical", W("W-19", "Electrical", "elec.shaver", "Shaver supply unit by the mirror — supply and install", 1, "no", "one (R-60)", { element_refs: room }));
  add("Electrical", W("W-20", "Electrical", "elec.extractor", "Ceiling extractor fan with run-on timer / humidistat — supply and install, ducted to the existing outlet", 1, "no", "one (R-61) — duct route to confirm", { element_refs: room }));

  // --- Lighting: cove LED along the bulkhead's open edges.
  const coveLm = ctx.bulkhead ? r2(glassSides.reduce((s, v) => s + v, 0)) : 0;
  if (coveLm > 0) {
    add("Lighting", W("W-21", "Lighting", "light.led_strip", "Cove LED strip, 2700 K — supply (along the bulkhead)", coveLm, "lm", `the bulkhead's open edges over the shower = ${glassSides.join(" + ")} = ${coveLm} lm`, { element_refs: room, rate_status: "indicative" }));
    add("Lighting", W("W-22", "Lighting", "ceiling.led_cove", "Cove LED channel — install (along the bulkhead)", coveLm, "lm", `as W-21 = ${coveLm} lm`, { element_refs: room }));
  }

  // --- Plumbing: reconnections only (the P2 points); the heater is kept and boxed in.
  remove("Plumbing", (l) => ["Q-19", "Q-20"].includes(ruleOf(l)));
  edit("Plumbing", (l) => ruleOf(l) === "Q-21", () => ({ description: "Shower drain (linear) at the existing position — supply and install", ...(shower ? { element_refs: [shower.id] } : {}) }));
  if (ctx.heater) add("Plumbing", W("W-23", "Plumbing", "plumb.heater_box", `Water heater — box in or relocate locally (existing heater kept; ${ctx.heater.where})`, 1, "no", `heater on the plan: ${ctx.heater.where} (R-62)`, { element_refs: [ctx.heater.id], rate_status: "site_assessment", confirm_on_site: `Water heater: confirm it stays and where (${ctx.heater.where}) — box-in is an allowance` }));
  remove("Plumbing & Sanitary", (l) => l.rule_id === "P2/overlay/water_heater");

  // --- Blockwork: the layout stays — no civil alterations.
  remove("Blockwork", (l) => ruleOf(l) === "Q-05");

  // --- Painting: wall paint above the tiled height (the take-off's line); the ceiling, always.
  add("Decoration & Painting", W("W-24", "Decoration & Painting", "paint.full", "Ceiling paint — anti-fungal primer + 2 coats", ctx.floor_m2, "m2", `ceiling = floor area ${ctx.floor_m2} m² (R-13)`, { element_refs: room }));

  // --- Options, outside the total.
  const options: BoqOption[] = [];
  const base = (rule: string) => [...sections.values()].flat().filter((l) => ruleOf(l) === rule);
  if (wcs.length) {
    const adds = [
      { ...W("WO-1", "Sanitaryware", "san.wc", "Wall-hung WC with concealed cistern frame — supply and install (existing soil position)", wcs.length, "no", "R-19 — the market WC-suite band the reference villa's wall-hung WCs were priced at"), work_section: "Sanitaryware" },
      { ...W("WO-2", "Sanitaryware", "san.actuator", "WC flush plate for the concealed cistern — supply", wcs.length, "no", "R-43"), work_section: "Sanitaryware" },
      { ...W("WO-3", "Sanitaryware", "san.wc_duct_wall", "Duct wall to the WC — MR board on the frame, waterproofed, tiled", wcs.length, "no", "R-63, ~1.2 m wide on the WC wall"), work_section: "Sanitaryware" },
    ] as BoqOption["adds"];
    const replaces = base("W-15");
    options.push({ key: "wall_hung_wc", label: "Wall-hung WC with concealed cistern", note: "The WC stays where it is, mounted on a frame with a concealed cistern behind a tiled duct wall — the look in your references. A plumbing change, priced as an option.", adds, replaces: replaces.map((l) => ({ description: l.description, rule_id: l.rule_id ?? "", total_aed: l.total_aed })), net_aed: money2(sumMoney(adds.map((a) => a.total_aed)) - sumMoney(replaces.map((l) => l.total_aed))) });
  }
  if (ctx.bulkhead && shower) {
    const adds = [{ ...W("WO-4", "Ceilings", "ceiling.bulkhead_removal", "Take down the curved bulkhead over the shower; make good to a flat ceiling; re-site its downlight", 1, "project", "R-64 — check what it conceals before pricing firm"), work_section: "Ceilings" }] as BoqOption["adds"];
    const replaces = [...base("W-21"), ...base("W-22")];
    options.push({ key: "bulkhead_removal", label: "Remove the bulkhead over the shower", note: "A flat ceiling over the shower. The cove light runs along the bulkhead, so it goes with it.", adds, replaces: replaces.map((l) => ({ description: l.description, rule_id: l.rule_id ?? "", total_aed: l.total_aed })), net_aed: money2(sumMoney(adds.map((a) => a.total_aed)) - sumMoney(replaces.map((l) => l.total_aed))) });
  }

  // Every line says what its rate rests on.
  const out = [...sections.entries()]
    .filter(([, lines]) => lines.length > 0)
    .map(([work_section, lines]) => ({ work_section, lines: lines.map((l) => ({ ...l, rate_basis: rateBasisOf(l) })), section_total_aed: 0 }));
  for (const o of options) o.adds = o.adds.map((a) => ({ ...a, rate_basis: rateBasisOf(a) }));
  const chained = rechain({ ...boq, sections: out } as unknown as ChainedDoc) as unknown as T;
  return { ...chained, options, wet_room: { package: WET_ROOM_PACKAGE, room_id: ctx.room_id } };
}

/** Each option's delta on the grand total — through the BoQ's own chain (OH&P, contingency, VAT). Call LAST. */
export function priceOptions<T extends ChainedDoc & { options?: BoqOption[] }>(boq: T): T {
  if (!boq.options?.length) return boq;
  const grand = boq.grand_total_aed;
  const options = boq.options.map((o) => {
    const c = chainTotals({ subtotal_aed: money2(boq.subtotal_aed + o.net_aed), contingency_pct: boq.contingency_pct, vat_pct: boq.vat_pct, ohp_pct: boq.ohp_pct });
    return { ...o, delta_total_aed: money2(c.grand_total_aed - grand) };
  });
  return { ...boq, options };
}

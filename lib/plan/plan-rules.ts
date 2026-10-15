// =============================================================================
// lib/plan/plan-rules.ts — the plan editor's guardrails (15 Oct). PURE.
//
// One set of rules for the editor (hard rules refuse a placement, with the
// reason inline), the 01 Plan check and the Issues navigator (every violation
// listed; a soft one can be kept with "Keep anyway"), the BoQ and the renders
// (an opening that "Needs a wall" is left out of both). Nothing else decides
// whether an opening is on a wall.
//
// Openings are placed on ROOM EDGES with a metric tolerance, not on the derived
// wall segments: those are only shared when two edges agree to 0.0025 units,
// which outlines drawn by hand rarely do, and an id-matched wall_ref goes stale
// with every outline edit (it renumbers) — the Jumeirah Parks plan showed
// windows drawn across their wall and doors in mid-room on exactly that. What
// is on each side of an opening is read by probing 0.3 m either side of it.
//
// Hard — the editor refuses; an existing one is listed:
//   1 on_wall       an opening sits on a wall (≤ 0.15 m), along it.        → Needs a wall
//   2 wall_short    its wall is shorter than it (or was deleted).          → Needs a wall
//   3 fit / overlap / height
//                   0.1 m clear at each end; no two on one wall overlap;
//                   door/archway height and window sill + height ≤ ceiling.
//   4 archway_shared / exterior_wall
//                   an archway joins two rooms; an exterior door or window
//                   has nothing (or a terrace / garden) on the other side.
// Exempt (ruled 15 Oct): gates, anything in a garden wall (`context_id`) and
// anything on a garden zone's edge or inside a garden zone — the garden is
// drawn with its own layers; these rules are for the house. They are never
// "Needs a wall" and never deducted from a house wall.
// Soft — listed, can be kept:
//   5 wet_room_door  6 window_interior  7 no_way_in  8 size  9 skew  11 label_lang
// Blocks regenerate:
//   10 unnamed       an in-scope room still called "New room".
// (12, labels that spill past small outlines, is lib/plan/label-fit.ts.)
// =============================================================================

import { isOutdoorType } from "./zones";
import { pointInPolygon, polygonArea, pointToSegment, type Pt } from "./polygon";
import { labelLanguageMismatch } from "./room-names";

export const ON_WALL_TOL_M = 0.15;
export const END_CLEAR_M = 0.1;
export const SIDE_PROBE_M = 0.3;
export const PARTY_WALL_TOL_M = 0.35;
export const SQUARE_SNAP_DEG = 5;
/** Below this an edge is square (float noise from editing). */
export const SQUARE_NOISE_DEG = 0.5;
export const CEILING_DEFAULT_M = 2.9;
export const INTERIOR_DOOR_M: [number, number] = [0.7, 1.2];
export const ARCHWAY_MIN_M = 0.9;
export const WINDOW_MAX_SHARE = 0.8;

export type RuleKey =
  | "on_wall"
  | "wall_short"
  | "fit"
  | "overlap"
  | "height"
  | "archway_shared"
  | "exterior_wall"
  | "wet_room_door"
  | "window_interior"
  | "no_way_in"
  | "size"
  | "skew"
  | "unnamed"
  | "label_lang";

export const RULE_NUMBER: Record<RuleKey, number> = {
  on_wall: 1, wall_short: 2, fit: 3, overlap: 3, height: 3, archway_shared: 4, exterior_wall: 4,
  wet_room_door: 5, window_interior: 6, no_way_in: 7, size: 8, skew: 9, unnamed: 10, label_lang: 11,
};

export type Severity = "hard" | "soft" | "blocks";

export const RULE_SEVERITY: Record<RuleKey, Severity> = {
  on_wall: "hard", wall_short: "hard", fit: "hard", overlap: "hard", height: "hard", archway_shared: "hard", exterior_wall: "hard",
  wet_room_door: "soft", window_interior: "soft", no_way_in: "soft", size: "soft", skew: "soft", label_lang: "soft",
  unnamed: "blocks",
};

/** Rules that put an opening on "Needs a wall": out of the BoQ and the renders. */
export const NEEDS_A_WALL: ReadonlySet<RuleKey> = new Set(["on_wall", "wall_short"]);

export interface RuleRoom {
  id: string;
  name_en?: string | null;
  name_ar?: string | null;
  room_type?: string | null;
  polygon: unknown;
  in_scope?: boolean | null;
  unroofed?: boolean | null;
  spec?: Record<string, unknown> | null;
}

export interface RuleOpening {
  id: string;
  kind: string;
  width_mm: number | null;
  height_mm?: number | null;
  sill_mm?: number | null;
  position: unknown;
  room_id?: string | null;
  source?: string | null;
  detection?: { opens_to?: string | null; opens_to_room_id?: string | null } | null;
  spec?: Record<string, unknown> | null;
  context_id?: string | null;
}

export interface Violation {
  rule: RuleKey;
  /** The brief's rule number (1–11). */
  n: number;
  severity: Severity;
  room_id?: string;
  opening_id?: string;
  message: string;
  /** A soft rule the owner chose to keep (spec.kept_rules). */
  kept?: boolean;
}

/** Where an opening sits, in the plan's own units and in metres. */
export interface Placement {
  opening_id: string;
  /** The room whose edge carries it, the edge's index, and its endpoints (plan units). */
  room_id: string;
  edge: number;
  a: Pt;
  b: Pt;
  /** 0–1 along the edge, and the distance off it (m). */
  t: number;
  off_m: number;
  /** Edge length (m) and the usable span on it (m from `a`) — the overlap with the room next door for a shared wall. */
  length_m: number;
  span_m: [number, number];
  /** Rooms either side (null = nothing there). */
  sides: [string | null, string | null];
}

const asPoly = (p: unknown): Pt[] | null =>
  Array.isArray(p) && p.length >= 3 && p.every((q) => Array.isArray(q) && q.length >= 2 && Number.isFinite(q[0]) && Number.isFinite(q[1]))
    ? (p as number[][]).map(([x, y]) => [x!, y!] as Pt)
    : null;

const asPt = (p: unknown): Pt | null =>
  Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [Number(p[0]), Number(p[1])] : null;

/**
 * Metres per plan unit, as buildPlanGraph measures: an authored plan's plot
 * width, else √(total area ÷ Σ outline area).
 */
export function metresPerUnit(rooms: readonly { polygon: unknown; area_m2?: number | null }[], totalAreaM2: number | null, plotWidthM?: number | null): number | null {
  if (plotWidthM && plotWidthM > 0) return plotWidthM;
  let units = 0;
  for (const r of rooms) {
    const p = asPoly(r.polygon);
    if (p) units += polygonArea(p);
  }
  // As buildPlanGraph: the plan total, else the rooms' own areas.
  const total = totalAreaM2 && totalAreaM2 > 0 ? totalAreaM2 : rooms.reduce((s, r) => s + (typeof r.area_m2 === "number" ? r.area_m2 : 0), 0);
  return units > 0 && total > 0 ? Math.sqrt(total / units) : null;
}

const WET = /\b(bath|bathroom|ensuite|en-suite|wc|toilet|powder|laundry|shower)\b/i;
const WET_TYPES = new Set(["bathroom", "ensuite", "powder", "laundry"]);
export const isWetRoom = (r: RuleRoom) => WET_TYPES.has(r.room_type ?? "") || WET.test(r.name_en ?? "");

/** Outside, for an exterior door or window: nothing, an outdoor zone, an unroofed zone, a terrace or a balcony. */
const isOutside = (r: RuleRoom | null) => !r || isOutdoorType(r.room_type) || r.unroofed === true || r.room_type === "terrace" || r.room_type === "balcony";
/** A room an archway can join: anything but an outdoor zone. */
const isRoom = (r: RuleRoom | null) => !!r && !isOutdoorType(r.room_type) && r.unroofed !== true;

const UNNAMED = /^(new (room|zone)|room|zone|untitled)(\s*\d+)?$/i;
export const isUnnamed = (name: string | null | undefined) => !name || !name.trim() || UNNAMED.test(name.trim());

const kept = (spec: Record<string, unknown> | null | undefined, rule: RuleKey) =>
  Array.isArray(spec?.kept_rules) && (spec!.kept_rules as unknown[]).includes(rule);

const deg = (rad: number) => (rad * 180) / Math.PI;

/** How far an edge is from square (0 = horizontal or vertical), in degrees. */
export function offSquareDeg(a: Pt, b: Pt): number {
  const ang = Math.abs(deg(Math.atan2(b[1] - a[1], b[0] - a[0]))) % 90;
  return Math.min(ang, 90 - ang);
}

interface Edge { room: RuleRoom; i: number; a: Pt; b: Pt }

function edgesOf(rooms: readonly RuleRoom[]): Edge[] {
  return rooms.flatMap((room) => {
    const p = asPoly(room.polygon);
    return p ? p.map((a, i) => ({ room, i, a, b: p[(i + 1) % p.length]! })) : [];
  });
}

function roomAt(rooms: readonly RuleRoom[], p: Pt, exclude?: string): RuleRoom | null {
  let best: { r: RuleRoom; area: number } | null = null;
  for (const r of rooms) {
    if (r.id === exclude) continue;
    const poly = asPoly(r.polygon);
    if (poly && pointInPolygon(p, poly)) {
      const area = polygonArea(poly);
      if (!best || area < best.area) best = { r, area }; // the smaller room wins where outlines overlap
    }
  }
  return best?.r ?? null;
}

/** Place an opening on the nearest room edge within 0.15 m. null = it needs a wall. */
export function placeOpening(o: RuleOpening, rooms: readonly RuleRoom[], mPerU: number): Placement | null {
  const p = asPt(o.position);
  if (!p || !(mPerU > 0)) return null;
  let best: { e: Edge; t: number; d: number } | null = null;
  for (const e of edgesOf(rooms)) {
    const { dist, t } = pointToSegment(p, e.a, e.b);
    const d = dist * mPerU;
    if (d > ON_WALL_TOL_M) continue;
    // Nearest; on a tie (a party wall drawn twice), the opening's own room.
    if (!best || d < best.d - 1e-6 || (Math.abs(d - best.d) <= 1e-6 && e.room.id === o.room_id)) best = { e, t, d };
  }
  if (!best) return null;
  const { e, t } = best;
  const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
  const ux = (e.b[0] - e.a[0]) / len, uy = (e.b[1] - e.a[1]) / len;
  const nx = -uy, ny = ux;
  const foot: Pt = [e.a[0] + ux * len * t, e.a[1] + uy * len * t];
  const probe = SIDE_PROBE_M / mPerU;
  const s1 = roomAt(rooms, [foot[0] + nx * probe, foot[1] + ny * probe]);
  const s2 = roomAt(rooms, [foot[0] - nx * probe, foot[1] - ny * probe]);
  const length_m = len * mPerU;
  let span: [number, number] = [0, length_m];
  // A wall shared with the room next door: only the part both rooms share takes an opening.
  const other = s1 && s1.id !== e.room.id ? s1 : s2 && s2.id !== e.room.id ? s2 : null;
  if (other) {
    let shared: [number, number] | null = null;
    for (const f of edgesOf([other])) {
      const flen = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]);
      if (flen === 0) continue;
      const cross = Math.abs(((f.b[0] - f.a[0]) / flen) * uy - ((f.b[1] - f.a[1]) / flen) * ux);
      if (cross > Math.sin((3 * Math.PI) / 180)) continue; // not parallel
      if (pointToSegment(foot, f.a, f.b).dist * mPerU > PARTY_WALL_TOL_M) continue;
      const pa = ((f.a[0] - e.a[0]) * ux + (f.a[1] - e.a[1]) * uy) * mPerU;
      const pb = ((f.b[0] - e.a[0]) * ux + (f.b[1] - e.a[1]) * uy) * mPerU;
      const lo = Math.max(0, Math.min(pa, pb)), hi = Math.min(length_m, Math.max(pa, pb));
      if (hi > lo && (!shared || hi - lo > shared[1] - shared[0])) shared = [lo, hi];
    }
    if (shared) span = shared;
  }
  return { opening_id: o.id, room_id: e.room.id, edge: e.i, a: e.a, b: e.b, t, off_m: best.d, length_m, span_m: span, sides: [s1?.id ?? null, s2?.id ?? null] };
}

const isExterior = (o: RuleOpening) => o.detection?.opens_to === "outside" || o.spec?.exterior === true;
const DEFAULT_WIDTH_MM: Record<string, number> = { door: 900, window: 1200, archway: 1200, gate: 1000 };
/** An opening stored without a width takes its kind's standard one (as buildPlanGraph does). */
const withWidth = <T extends RuleOpening>(o: T): T => (o.width_mm == null ? { ...o, width_mm: DEFAULT_WIDTH_MM[o.kind] ?? 900 } : o);
const widthM = (o: RuleOpening) => (o.width_mm ?? 0) / 1000;

/** Two placed openings on the same wall line whose widths (m) overlap. */
export function placementsOverlap(A: Placement, wA: number, B: Placement, wB: number, mPerU: number): boolean {
  const ux = A.b[0] - A.a[0], uy = A.b[1] - A.a[1], L = Math.hypot(ux, uy);
  const vx = B.b[0] - B.a[0], vy = B.b[1] - B.a[1], M = Math.hypot(vx, vy);
  if (L === 0 || M === 0) return false;
  if (Math.abs((ux / L) * (vy / M) - (uy / L) * (vx / M)) > 0.05) return false; // not parallel
  const cA: Pt = [A.a[0] + ux * A.t, A.a[1] + uy * A.t], cB: Pt = [B.a[0] + vx * B.t, B.a[1] + vy * B.t];
  if (Math.abs((cB[0] - cA[0]) * (-uy / L) + (cB[1] - cA[1]) * (ux / L)) * mPerU > PARTY_WALL_TOL_M) return false; // a different wall
  const along = Math.abs(((cB[0] - cA[0]) * ux + (cB[1] - cA[1]) * uy) / L) * mPerU;
  return along < (wA + wB) / 2 - 0.01;
}

/**
 * Every hard rule for ONE opening at a proposed position, as the editor asks
 * before an add, a drop or a resize: the reason it is refused, or null.
 */
export function hardProblemFor(o: RuleOpening, others: readonly RuleOpening[], rooms: readonly RuleRoom[], mPerU: number, ceilingM = CEILING_DEFAULT_M): { rule: RuleKey; message: string } | null {
  const cand = withWidth(o);
  const pl = placeOpening(cand, rooms, mPerU);
  if (inGarden(cand, rooms, mPerU, pl)) return null;
  if (!pl) return { rule: "on_wall", message: "An opening sits on a wall — drop it on one." };
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const sides: [RuleRoom | null, RuleRoom | null] = [pl.sides[0] ? byId.get(pl.sides[0])! : null, pl.sides[1] ? byId.get(pl.sides[1])! : null];
  const roofed = sides.some((s) => s && !isOutdoorType(s.room_type) && s.unroofed !== true);
  // The wrong kind of wall first: no position along it would make it right.
  const wp = wallKindProblem(cand, sides);
  if (wp) return wp;
  const fp = fitProblem(cand, pl, roofed ? ceilingM : Infinity);
  if (fp) return fp;
  for (const other of others) {
    if (other.id === cand.id || other.kind === "gate" || other.context_id) continue;
    const ow = withWidth(other);
    const opl = placeOpening(ow, rooms, mPerU);
    if (opl && placementsOverlap(pl, widthM(cand), opl, widthM(ow), mPerU)) return { rule: "overlap", message: `It would overlap the ${ow.kind} already on this wall.` };
  }
  return null;
}

/** The fit checks for one opening on its placement (rules 2 and 3), as the editor asks them before a drop. */
export function fitProblem(o: Pick<RuleOpening, "kind" | "width_mm" | "height_mm" | "sill_mm">, pl: Pick<Placement, "t" | "length_m" | "span_m">, ceilingM = CEILING_DEFAULT_M): { rule: RuleKey; message: string } | null {
  const w = (o.width_mm ?? 0) / 1000;
  const usable = pl.span_m[1] - pl.span_m[0];
  if (w > usable + 1e-6) return { rule: "wall_short", message: `A ${w.toFixed(2)} m ${o.kind} does not fit on this ${usable.toFixed(2)} m wall.` };
  const c = pl.t * pl.length_m;
  if (w > usable - 2 * END_CLEAR_M + 1e-6 || c - w / 2 < pl.span_m[0] + END_CLEAR_M - 1e-6 || c + w / 2 > pl.span_m[1] - END_CLEAR_M + 1e-6) {
    return { rule: "fit", message: `Keep ${END_CLEAR_M * 100} cm of wall at each end of the ${o.kind} — this wall takes up to ${Math.max(0, usable - 2 * END_CLEAR_M).toFixed(2)} m.` };
  }
  const h = (o.height_mm ?? 0) / 1000, sill = (o.sill_mm ?? 0) / 1000;
  if ((o.kind === "door" || o.kind === "archway") && h > ceilingM + 1e-6) return { rule: "height", message: `The ${o.kind} is ${h.toFixed(2)} m tall — taller than the ${ceilingM.toFixed(2)} m ceiling.` };
  if (o.kind === "window" && sill + h > ceilingM + 1e-6) return { rule: "height", message: `Sill ${sill.toFixed(2)} m + window ${h.toFixed(2)} m is above the ${ceilingM.toFixed(2)} m ceiling.` };
  return null;
}

/** Rule 4 for a placement: what may go on a wall, given what is either side of it. */
export function wallKindProblem(o: Pick<RuleOpening, "kind" | "detection" | "spec">, sides: [RuleRoom | null, RuleRoom | null]): { rule: RuleKey; message: string } | null {
  const [s1, s2] = sides;
  if (o.kind === "archway" && !(isRoom(s1) && isRoom(s2))) return { rule: "archway_shared", message: "An archway joins two rooms — this wall has nothing on the other side." };
  if ((o.kind === "door" || o.kind === "window") && isExterior(o as RuleOpening) && !isOutside(s1) && !isOutside(s2)) {
    return { rule: "exterior_wall", message: `An outside ${o.kind} needs nothing on the other side — this wall is between ${s1?.name_en ?? "a room"} and ${s2?.name_en ?? "a room"}.` };
  }
  return null;
}

const isGardenZone = (r: RuleRoom | null | undefined) => !!r && (isOutdoorType(r.room_type) || r.unroofed === true);

/**
 * In the garden: a gate, an opening in a garden wall, or one on a garden zone's
 * edge (no roofed room either side) or inside a garden zone. Exempt from the
 * plan rules (ruled 15 Oct).
 */
export function inGarden(o: RuleOpening, rooms: readonly RuleRoom[], mPerU: number, pl: Placement | null = placeOpening(o, rooms, mPerU)): boolean {
  if (o.kind === "gate" || o.context_id) return true;
  const byId = new Map(rooms.map((r) => [r.id, r]));
  if (pl) return !pl.sides.some((id) => id && !isGardenZone(byId.get(id)));
  const p = asPt(o.position);
  return !!p && rooms.some((r) => {
    if (!isGardenZone(r)) return false;
    const poly = asPoly(r.polygon);
    return !!poly && pointInPolygon(p, poly);
  });
}

export interface PlanRulesInput {
  rooms: readonly RuleRoom[];
  openings: readonly RuleOpening[];
  /** Metres per plan unit (metresPerUnit). */
  mPerU: number;
  ceilingM?: number;
}

export interface PlanRulesResult {
  violations: Violation[];
  placements: Map<string, Placement>;
  /** Openings on "Needs a wall" — left out of the BoQ and the renders. */
  needsWall: Set<string>;
}

/** Every rule over a plan. Gates (garden walls) are not room openings and are not checked. */
export function checkPlan({ rooms, openings, mPerU, ceilingM = CEILING_DEFAULT_M }: PlanRulesInput): PlanRulesResult {
  const out: Violation[] = [];
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const name = (id: string | null | undefined) => (id ? byId.get(id)?.name_en?.trim() || "a room" : "outside");
  const push = (rule: RuleKey, message: string, ids: { room_id?: string; opening_id?: string }, spec?: Record<string, unknown> | null) => {
    const v: Violation = { rule, n: RULE_NUMBER[rule], severity: RULE_SEVERITY[rule], ...ids, message };
    if (v.severity === "soft" && kept(spec, rule)) v.kept = true;
    out.push(v);
  };
  const placements = new Map<string, Placement>();
  const needsWall = new Set<string>();
  const roomOpenings = openings.filter((o) => o.kind !== "gate" && !o.context_id).map(withWidth).filter((o) => !inGarden(o, rooms, mPerU));
  const label = (o: RuleOpening) => {
    const pl = placements.get(o.id);
    const where = pl ? pl.sides.filter(Boolean).map((id) => name(id)).join(" / ") : name(o.room_id);
    return `${o.kind[0]!.toUpperCase()}${o.kind.slice(1)} (${(widthM(o)).toFixed(2)} m)${where ? ` in ${where}` : ""}`;
  };

  // 1–4: each opening on its wall.
  for (const o of roomOpenings) {
    const pl = placeOpening(o, rooms, mPerU);
    if (!pl) {
      needsWall.add(o.id);
      push("on_wall", `${label(o)} is not on a wall — Needs a wall.`, { opening_id: o.id }, o.spec);
      continue;
    }
    placements.set(o.id, pl);
    const sides: [RuleRoom | null, RuleRoom | null] = [pl.sides[0] ? byId.get(pl.sides[0])! : null, pl.sides[1] ? byId.get(pl.sides[1])! : null];
    const roofed = sides.some((s) => s && !isOutdoorType(s.room_type) && s.unroofed !== true);
    const fp = fitProblem(o, pl, roofed ? ceilingM : Infinity);
    if (fp?.rule === "wall_short") needsWall.add(o.id);
    if (fp) push(fp.rule, `${label(o)}: ${fp.message}${fp.rule === "wall_short" ? " Needs a wall." : ""}`, { opening_id: o.id }, o.spec);
    const wp = wallKindProblem(o, sides);
    if (wp) push(wp.rule, `${label(o)}: ${wp.message}`, { opening_id: o.id }, o.spec);
  }

  // 3: no two openings overlap on one wall (same line, intervals overlap).
  const placed = roomOpenings.filter((o) => placements.has(o.id) && !needsWall.has(o.id));
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const A = placements.get(placed[i]!.id)!, B = placements.get(placed[j]!.id)!;
      if (placementsOverlap(A, widthM(placed[i]!), B, widthM(placed[j]!), mPerU)) {
        push("overlap", `${label(placed[i]!)} overlaps ${label(placed[j]!).replace(/^./, (c) => c.toLowerCase())} on the same wall.`, { opening_id: placed[j]!.id }, placed[j]!.spec);
      }
    }
  }

  // Who each room can be reached through.
  const reach = new Map<string, RuleOpening[]>();
  for (const o of placed) {
    for (const id of placements.get(o.id)!.sides) if (id) reach.set(id, [...(reach.get(id) ?? []), o]);
  }

  // 5–8: soft rules on the openings that are placed.
  for (const o of placed) {
    const pl = placements.get(o.id)!;
    const sides = pl.sides.map((id) => (id ? byId.get(id)! : null)) as [RuleRoom | null, RuleRoom | null];
    const interior = sides.every((s) => s && !isOutside(s));
    const usable = pl.span_m[1] - pl.span_m[0];
    if (o.kind === "window" && interior) push("window_interior", `Window between ${name(pl.sides[0])} and ${name(pl.sides[1])} — is this right?`, { opening_id: o.id }, o.spec);
    if (o.kind === "door" && sides.every((s) => s) && (widthM(o) < INTERIOR_DOOR_M[0] - 1e-6 || widthM(o) > INTERIOR_DOOR_M[1] + 1e-6)) push("size", `${label(o)}: an inside door is usually 0.70–1.20 m.`, { opening_id: o.id }, o.spec);
    if (o.kind === "window" && widthM(o) > WINDOW_MAX_SHARE * usable + 1e-6) push("size", `${label(o)} takes ${Math.round((widthM(o) / usable) * 100)}% of its ${usable.toFixed(2)} m wall.`, { opening_id: o.id }, o.spec);
    if (o.kind === "archway" && widthM(o) < ARCHWAY_MIN_M - 1e-6) push("size", `${label(o)}: an archway under 0.90 m reads as a doorway.`, { opening_id: o.id }, o.spec);
  }
  for (const r of rooms) {
    if (r.in_scope === false || isOutdoorType(r.room_type) || r.unroofed === true) continue;
    const ways = (reach.get(r.id) ?? []).filter((o) => o.kind === "door" || o.kind === "archway");
    const nm = r.name_en?.trim() || "this room";
    if (isWetRoom(r)) {
      const arch = ways.some((o) => o.kind === "archway");
      if (arch || !ways.some((o) => o.kind === "door")) push("wet_room_door", `${arch ? `Archway into ${nm}` : `No door into ${nm}`} — bathrooms normally have a door.`, { room_id: r.id }, r.spec);
    } else if (ways.length === 0) {
      push("no_way_in", `No way into ${nm}.`, { room_id: r.id }, r.spec);
    }
  }

  // 9: edges off square.
  for (const r of rooms) {
    const p = asPoly(r.polygon);
    if (!p) continue;
    const skewed = p
      .map((a, i) => ({ i, d: offSquareDeg(a, p[(i + 1) % p.length]!), len: Math.hypot(p[(i + 1) % p.length]![0] - a[0], p[(i + 1) % p.length]![1] - a[1]) * mPerU }))
      .filter((e) => e.len >= 0.3 && e.d > SQUARE_NOISE_DEG);
    if (skewed.length === 0) continue;
    const worst = Math.max(...skewed.map((e) => e.d));
    const nm = r.name_en?.trim() || "A room";
    push(
      "skew",
      worst > SQUARE_SNAP_DEG
        ? `${nm}: ${skewed.length} ${skewed.length === 1 ? "edge is" : "edges are"} off square (up to ${worst.toFixed(1)}°).`
        : `${nm}: ${skewed.length} ${skewed.length === 1 ? "edge is" : "edges are"} ${worst.toFixed(1)}° off square — drag a corner and it snaps square.`,
      { room_id: r.id },
      r.spec,
    );
  }

  // 10–11: names.
  for (const r of rooms) {
    if (r.in_scope !== false && isUnnamed(r.name_en)) push("unnamed", `Name this ${isOutdoorType(r.room_type) ? "zone" : "room"} (now "${r.name_en?.trim() || "unnamed"}") or mark it out of scope before regenerating.`, { room_id: r.id });
    const mismatch = labelLanguageMismatch(r.name_en, r.name_ar);
    if (mismatch) push("label_lang", `${r.name_en}: the Arabic label still says ${r.name_ar} (${mismatch}) — update it.`, { room_id: r.id }, r.spec);
  }

  const order: Record<Severity, number> = { blocks: 0, hard: 1, soft: 2 };
  out.sort((x, y) => Number(!!x.kept) - Number(!!y.kept) || order[x.severity] - order[y.severity] || x.n - y.n);
  return { violations: out, placements, needsWall };
}

/** Openings a priced or rendered view may use: placed on a wall that takes them. */
export function openingsOnWalls<T extends RuleOpening>(openings: readonly T[], rooms: readonly RuleRoom[], mPerU: number | null): T[] {
  if (!mPerU) return [...openings];
  const { needsWall } = checkPlan({ rooms, openings, mPerU });
  return openings.filter((o) => !needsWall.has(o.id));
}

/**
 * Rule 9 in the editor: a dragged corner snaps so the two edges it meets are
 * square when they are within 5° of it — the edge to the previous corner first,
 * then the next one (each sets the coordinate the other left alone).
 */
export function snapVertexSquare(prev: Pt, v: Pt, next: Pt, maxDeg = SQUARE_SNAP_DEG): Pt {
  const out: Pt = [v[0], v[1]];
  let fixedX = false, fixedY = false;
  for (const n of [prev, next]) {
    const dx = out[0] - n[0], dy = out[1] - n[1];
    if (Math.hypot(dx, dy) === 0) continue;
    const a = Math.abs(deg(Math.atan2(dy, dx))) % 180;
    const offH = Math.min(a, 180 - a); // from horizontal
    const offV = Math.abs(90 - a); // from vertical
    if (offH <= maxDeg && !fixedY) { out[1] = n[1]; fixedY = true; }
    else if (offV <= maxDeg && !fixedX) { out[0] = n[0]; fixedX = true; }
  }
  return out;
}

/**
 * The wall an opening is drawn on: the nearest wall segment to its POSITION,
 * within `tolUnits` — never its stored `wall_ref`, which renumbers with every
 * outline edit (the Jumeirah Parks windows drawn across their walls). null =
 * on no wall ("Needs a wall").
 */
export function wallAt<W extends { a: Pt; b: Pt }>(walls: readonly W[], p: Pt, tolUnits: number): W | null {
  let best: { w: W; d: number } | null = null;
  for (const w of walls) {
    const d = pointToSegment(p, w.a, w.b).dist;
    if (!best || d < best.d) best = { w, d };
  }
  return best && best.d <= tolUnits ? best.w : null;
}

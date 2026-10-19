// =============================================================================
// lib/drawings/room-sheets.ts — one room's drawings, for the tiler and the
// client (bathroom pilot B6). Pure SVG, A3, 1:20.
//
//   (Numbered R- — the room pack's own series, so they never share a number with the
//   general drawing set's A- sheets in the same export.)
//   R-101  the dimensioned plan: walls, the door with its leaf and swing (from
//          the opening's spec.hinge — "W" = the hinge at the west jamb), the
//          window, every fixture footprint with its code, the shower glass on
//          the footprint's open sides, and a dimension chain along every wall
//          (corner → jamb → jamb → corner) plus each fixture's centre from the
//          nearest corner.
//   R-201… one ELEVATION per wall, seen from inside the room: the wall at its
//          length × the ceiling, the tiled band with the tile SETTING-OUT
//          (equal cuts at both ends, the joint or the tile centred on the wall's
//          centreline — whichever leaves the larger cut; courses from the floor,
//          the top cut dimensioned), every door and window with its sill and
//          head, and the fixtures on that wall at their standard heights
//          (WC, bidet, vanity + mirror + shaver point, shower valve + rain head,
//          niche, water heater) — heights a fitter confirms, printed with ≈.
//
// Every dimension carries data-dim / data-mm / data-src (an expression over the
// graph or the fixture), so a test checks each printed figure against the graph
// to the millimetre. Nothing here is priced.
// =============================================================================

import { footprintCorners, footprintOf } from "@/lib/overlays/footprint";
import type { Opening, PlanGraph, Point, Room } from "@/lib/plan/geometry";

import { esc, FONT_MONO, FONT_UI, INK_100, INK_500, INK_700, INK_900, PAPER, PAPER_100, renderSheet, type SheetMeta } from "./sheet";

/** 1:20 — 50 mm of paper per metre. */
export const ROOM_MM_PER_M = 50;
const S = ROOM_MM_PER_M;
const TICK = 1.2;
const WALL_T_M = 0.1;

export interface RoomFixtureIn {
  id: string;
  type: string;
  /** Plan normalised space (like rooms.polygon). */
  position: [number, number];
  spec: Record<string, unknown> | null;
}

export interface RoomSheetsInput {
  graph: PlanGraph;
  roomId: string;
  fixtures: readonly RoomFixtureIn[];
  /** The wall tile, w × h in mm as laid; `source` says where it came from. */
  tile: { w_mm: number; h_mm: number; source: "design" | "assumed" };
  /** The design spec mirror line, when there is one: its shape follows it (round or rectangular). */
  mirror?: string | null;
  meta: SheetMeta;
}

export interface RoomSheet {
  number: string;
  title: string;
  svg: string;
}

// --- geometry ------------------------------------------------------------------------------

type V = [number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
const len = (a: V) => Math.hypot(a[0], a[1]);
const unit = (a: V): V => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
const mm = (m: number) => Math.round(m * 1000);

export interface RoomWall {
  /** "North", "East", … — the side of the room it is on. */
  side: string;
  a: V;
  b: V;
  length_m: number;
  /** Into the room. */
  inward: V;
  /** Seen from inside: the wall's left end and its run to the right. */
  left: V;
  right: V;
}

function centroid(poly: readonly Point[]): V {
  return [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
}

const SIDE = (n: V) => {
  // The wall is on the side OPPOSITE its inward normal (y down = south).
  const out: V = [-n[0], -n[1]];
  return Math.abs(out[0]) > Math.abs(out[1]) ? (out[0] > 0 ? "East" : "West") : out[1] > 0 ? "South" : "North";
};

/** The room's walls, each with its inward normal and its run as seen from inside. */
export function roomWalls(room: Room): RoomWall[] {
  const c = centroid(room.polygon);
  const out: RoomWall[] = [];
  for (let i = 0; i < room.polygon.length; i++) {
    const a = room.polygon[i]! as V, b = room.polygon[(i + 1) % room.polygon.length]! as V;
    const d = unit(sub(b, a));
    let n: V = [-d[1], d[0]];
    if (dot(sub(c, a), n) < 0) n = [-n[0], -n[1]];
    // Facing the wall = −n; the viewer's right in plan (y down) = (n.y, −n.x)… rotate the facing by +90°.
    const f: V = [-n[0], -n[1]];
    const r: V = [-f[1], f[0]];
    const [left, right] = dot(a, r) <= dot(b, r) ? [a, b] : [b, a];
    out.push({ side: SIDE(n), a, b, length_m: len(sub(b, a)), inward: n, left, right });
  }
  return out;
}

/** Where along a wall (m from its left end, seen from inside) a plan point falls, and how far off it. */
function along(w: RoomWall, p: V): { s: number; off: number } {
  const r = unit(sub(w.right, w.left));
  const q = sub(p, w.left);
  return { s: dot(q, r), off: Math.abs(dot(q, w.inward)) };
}

/** The wall an opening is on (nearest wall, within 0.2 m). */
function wallOf(walls: readonly RoomWall[], p: V): RoomWall | null {
  let best: { w: RoomWall; off: number } | null = null;
  for (const w of walls) {
    const a = along(w, p);
    if (a.s < -0.05 || a.s > w.length_m + 0.05) continue;
    if (!best || a.off < best.off) best = { w, off: a.off };
  }
  return best && best.off <= 0.2 ? best.w : null;
}

interface FixtureGeom {
  f: RoomFixtureIn;
  corners: V[];
  centre: V;
  /** Walls the footprint's sides lie on, with the span along each (m from the left end). */
  onWalls: { w: RoomWall; s0: number; s1: number }[];
  /** Footprint sides open to the room (a shower's glass). */
  free: [V, V][];
}

function fixtureGeoms(input: RoomSheetsInput, walls: readonly RoomWall[]): FixtureGeom[] {
  const k = input.graph.meta.unit_to_m, o = input.graph.meta.norm_origin;
  const toM = (p: Point): V => [(p[0] - o[0]) * k, (p[1] - o[1]) * k];
  return input.fixtures
    .filter((f) => f.type !== "floor_drain")
    .map((f) => {
      const fp = footprintOf(f.type, f.spec);
      const centre = toM(f.position as Point);
      const corners = fp ? footprintCorners(f.position, fp, k).map((p) => toM(p as Point)) : [];
      const onWalls: FixtureGeom["onWalls"] = [];
      const free: [V, V][] = [];
      for (let i = 0; i < corners.length; i++) {
        const a = corners[i]!, b = corners[(i + 1) % corners.length]!;
        const w = walls.find((x) => along(x, a).off <= 0.06 && along(x, b).off <= 0.06);
        if (w) {
          const sa = along(w, a).s, sb = along(w, b).s;
          onWalls.push({ w, s0: Math.min(sa, sb), s1: Math.max(sa, sb) });
        } else free.push([a, b]);
      }
      // A footprint-less fixture (a heater) belongs to its nearest wall at its own point.
      if (!fp) {
        const w = wallOf(walls, centre) ?? walls.slice().sort((x, y) => along(x, centre).off - along(y, centre).off)[0]!;
        const s = along(w, centre).s;
        const wid = typeof f.spec?.width_mm === "number" ? (f.spec.width_mm as number) / 1000 : f.type === "shattaf_point" ? 0.1 : 0.8;
        onWalls.push({ w, s0: s - wid / 2, s1: s + wid / 2 });
      }
      return { f, corners, centre, onWalls, free };
    });
}

// --- drawing helpers -----------------------------------------------------------------------

const n2 = (v: number) => v.toFixed(2);
const T = (x: number, y: number, s: string, o: { size?: number; fill?: string; anchor?: string; mono?: boolean; weight?: number; rotate?: boolean; attrs?: string } = {}) =>
  `<text x="${n2(x)}" y="${n2(y)}" font-size="${o.size ?? 2.6}" fill="${o.fill ?? INK_700}"${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.rotate ? ` transform="rotate(-90 ${n2(x)} ${n2(y)})"` : ""} style="font-family:${o.mono === false ? FONT_UI : FONT_MONO}${o.weight ? `;font-weight:${o.weight}` : ""}"${o.attrs ? ` ${o.attrs}` : ""}>${esc(s)}</text>`;
const L = (x1: number, y1: number, x2: number, y2: number, o: { stroke?: string; w?: number; dash?: string } = {}) =>
  `<line x1="${n2(x1)}" y1="${n2(y1)}" x2="${n2(x2)}" y2="${n2(y2)}" stroke="${o.stroke ?? INK_500}" stroke-width="${o.w ?? 0.25}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ""}/>`;

/**
 * A dimension between two paper points along a line offset from them, with the
 * value in mm and its source. `approx` prints ≈ (a standard height, not measured).
 */
function dim(p0: V, p1: V, off: V, valueMm: number, src: string, o: { approx?: boolean; key?: string } = {}): string {
  const a = add(p0, off), b = add(p1, off);
  const d = unit(sub(b, a));
  const nrm: V = [-d[1], d[0]];
  const mid = mul(add(a, b), 0.5);
  const vertical = Math.abs(d[1]) > Math.abs(d[0]);
  const lbl = add(mid, mul(unit(off), 1.6));
  let s = L(p0[0], p0[1], a[0], a[1], { stroke: INK_100, w: 0.15 }) + L(p1[0], p1[1], b[0], b[1], { stroke: INK_100, w: 0.15 });
  s += L(a[0], a[1], b[0], b[1], { stroke: INK_500, w: 0.22 });
  for (const q of [a, b]) s += L(q[0] - nrm[0] * TICK - d[0] * TICK, q[1] - nrm[1] * TICK - d[1] * TICK, q[0] + nrm[0] * TICK + d[0] * TICK, q[1] + nrm[1] * TICK + d[1] * TICK, { stroke: INK_700, w: 0.25 });
  s += T(lbl[0] + (vertical ? 0.9 : 0), lbl[1] + (vertical ? 0 : 0.9), `${o.approx ? "≈ " : ""}${valueMm}`, { anchor: "middle", rotate: vertical, attrs: `data-dim="${esc(o.key ?? src)}" data-mm="${valueMm}" data-src="${esc(src)}"${o.approx ? ' data-approx="true"' : ""}` });
  return s;
}

const CODE: Record<string, string> = { wc_point: "WC", bidet_point: "BD", basin_point: "VAN", shower_mixer: "SH", bath_point: "BT", water_heater: "WH", storage_cabinet: "CB", shattaf_point: "SF" };
const NAME: Record<string, string> = { wc_point: "Floor-standing WC", bidet_point: "Bidet", basin_point: "Vanity + basin", shower_mixer: "Shower", bath_point: "Bath", water_heater: "Water heater (existing)", storage_cabinet: "Storage cabinet (white)", shattaf_point: "Shattaf (health faucet)" };

function openingsOf(graph: PlanGraph, roomId: string): Opening[] {
  return graph.openings.filter((o) => o.position && (o.room_id === roomId || graph.walls.find((w) => w.id === o.wall_id)?.room_ids.includes(roomId)));
}

/** The door's hinge end: "W" | "E" | "N" | "S" → the jamb nearer that side; absent = not stated. */
function hingeJamb(o: Opening, j0: V, j1: V): { hinge: V; free: V; stated: boolean } {
  const h = typeof o.spec?.hinge === "string" ? (o.spec.hinge as string).toUpperCase() : null;
  const dir: Record<string, V> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
  if (!h || !dir[h]) return { hinge: j0, free: j1, stated: false };
  return dot(j0, dir[h]!) >= dot(j1, dir[h]!) ? { hinge: j0, free: j1, stated: true } : { hinge: j1, free: j0, stated: true };
}

// --- R-101: the dimensioned plan -----------------------------------------------------------

export function renderRoomPlan(input: RoomSheetsInput): RoomSheet {
  const room = input.graph.rooms.find((r) => r.id === input.roomId)!;
  const walls = roomWalls(room);
  const fx = fixtureGeoms(input, walls);
  const xs = room.polygon.map((p) => p[0]), ys = room.polygon.map((p) => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
  // Centre the room in the drawing area left of the notes column.
  const ox = 70 + (200 - (maxX - minX) * S) / 2 - minX * S, oy = 40 + (190 - (maxY - minY) * S) / 2 - minY * S;
  const P = (p: V): V => [ox + p[0] * S, oy + p[1] * S];
  const poly = (pts: readonly V[]) => pts.map((p) => P(p).map(n2).join(",")).join(" ");
  let body = "";

  // Walls: a band of WALL_T_M outside the internal faces (stroked twice its width, inside covered).
  body += `<polygon points="${poly(room.polygon as V[])}" fill="none" stroke="${INK_900}" stroke-width="${n2(WALL_T_M * 2 * S)}" stroke-linejoin="miter"/>`;
  body += `<polygon points="${poly(room.polygon as V[])}" fill="${PAPER}" stroke="${INK_900}" stroke-width="0.35" data-room="${esc(room.id)}"/>`;

  // Fixtures.
  for (const g of fx) {
    if (g.corners.length) {
      body += `<polygon points="${poly(g.corners)}" fill="none" stroke="${INK_700}" stroke-width="0.3" data-fixture="${esc(g.f.id)}" data-fixture-type="${esc(g.f.type)}"/>`;
      if (g.f.type === "shower_mixer") for (const [a, b] of g.free) {
        const [pa, pb] = [P(a), P(b)];
        body += L(pa[0], pa[1], pb[0], pb[1], { stroke: INK_900, w: 0.6 }) + `<g data-glass="true"></g>`;
      }
    }
    // A point fixture on a wall (a shattaf, a heater): its code sits inside the room, off the wall band.
    const c = P(!g.corners.length && g.onWalls[0] ? add(g.centre, mul(g.onWalls[0].w.inward, 0.14)) : g.centre);
    body += T(c[0], c[1] + 0.9, CODE[g.f.type] ?? g.f.type, { anchor: "middle", size: 2.8, fill: INK_900, weight: 600 });
  }
  for (const d of input.fixtures.filter((f) => f.type === "floor_drain")) {
    const k = input.graph.meta.unit_to_m, o = input.graph.meta.norm_origin;
    const c = P([(d.position[0] - o[0]) * k, (d.position[1] - o[1]) * k]);
    body += `<rect x="${n2(c[0] - 2.5)}" y="${n2(c[1] - 2.5)}" width="5" height="5" fill="none" stroke="${INK_700}" stroke-width="0.3"/>` + L(c[0] - 2.5, c[1] - 2.5, c[0] + 2.5, c[1] + 2.5, { w: 0.2 }) + L(c[0] + 2.5, c[1] - 2.5, c[0] - 2.5, c[1] + 2.5, { w: 0.2 }) + T(c[0] + 3.5, c[1] + 1, "FD", { size: 2.4 });
  }

  // Openings: cut the wall band, draw the door leaf + swing or the window.
  const notes: string[] = [];
  for (const o of openingsOf(input.graph, room.id)) {
    const w = wallOf(walls, o.position as V);
    if (!w) continue;
    const r = unit(sub(w.right, w.left));
    const s = along(w, o.position as V).s;
    const half = o.width_mm / 2000;
    const j0 = add(w.left, mul(r, s - half)), j1 = add(w.left, mul(r, s + half));
    const outward = mul(w.inward, -1);
    const band = [j0, j1, add(j1, mul(outward, WALL_T_M)), add(j0, mul(outward, WALL_T_M))];
    body += `<polygon points="${poly(band)}" fill="${PAPER}" stroke="none"/>`;
    const [p0, p1] = [P(j0), P(j1)];
    if (o.type === "window") {
      for (const t of [0, 0.5, 1]) {
        const q0 = P(add(j0, mul(outward, WALL_T_M * t))), q1 = P(add(j1, mul(outward, WALL_T_M * t)));
        body += L(q0[0], q0[1], q1[0], q1[1], { stroke: INK_900, w: 0.3 });
      }
      body += `<g data-opening="${esc(o.id)}" data-opening-type="window"></g>`;
    } else {
      const { hinge, free, stated } = hingeJamb(o, j0, j1);
      const swingIn = (o.spec?.swing as string | undefined) !== "out";
      const into = swingIn ? w.inward : outward;
      const leafTip = add(hinge, mul(into, o.width_mm / 1000));
      const [ph, pf, pt] = [P(hinge), P(free), P(leafTip)];
      const rad = (o.width_mm / 1000) * S;
      // Sweep: the arc from the leaf tip back to the free jamb, the short way.
      const cross = (pt[0] - ph[0]) * (pf[1] - ph[1]) - (pt[1] - ph[1]) * (pf[0] - ph[0]);
      body += L(ph[0], ph[1], pt[0], pt[1], { stroke: INK_900, w: 0.4 });
      body += `<path d="M ${n2(pt[0])} ${n2(pt[1])} A ${n2(rad)} ${n2(rad)} 0 0 ${cross > 0 ? 1 : 0} ${n2(pf[0])} ${n2(pf[1])}" fill="none" stroke="${INK_500}" stroke-width="0.25"${stated ? "" : ' stroke-dasharray="1 0.8"'} data-opening="${esc(o.id)}" data-opening-type="door" data-hinge="${stated ? esc(String(o.spec!.hinge)) : "not stated"}"/>`;
      if (!stated) notes.push("Door hinge side not stated — swing drawn dashed; confirm on site.");
      else notes.push(`Door: hinge ${String(o.spec!.hinge).toUpperCase()}, opens ${swingIn ? "in" : "out"}.`);
    }
    void p0;
    void p1;
  }

  // Dimension chains along every wall: corner → each opening's jambs → corner.
  for (const w of walls) {
    const r = unit(sub(w.right, w.left));
    const outward = mul(w.inward, -1);
    const offPaper = mul(outward, (WALL_T_M + 0.35) * S);
    const cuts: { s: number; src: string }[] = [{ s: 0, src: "corner" }];
    for (const o of openingsOf(input.graph, room.id)) {
      if (wallOf(walls, o.position as V) !== w) continue;
      const s = along(w, o.position as V).s, half = o.width_mm / 2000;
      cuts.push({ s: s - half, src: `${o.id}.jamb0` }, { s: s + half, src: `${o.id}.jamb1` });
    }
    cuts.push({ s: w.length_m, src: "corner" });
    cuts.sort((a, b) => a.s - b.s);
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = P(add(w.left, mul(r, cuts[i]!.s))), b = P(add(w.left, mul(r, cuts[i + 1]!.s)));
      const v = mm(cuts[i + 1]!.s - cuts[i]!.s);
      if (v > 0) body += dim(a, b, offPaper, v, `${w.side}:${cuts[i]!.src}→${cuts[i + 1]!.src}`);
    }
    // The overall internal length, one step further out.
    if (cuts.length > 2) body += dim(P(w.left), P(w.right), mul(outward, (WALL_T_M + 0.75) * S), mm(w.length_m), `${w.side}:length`, { key: `wall:${w.side}` });
    else body += `<g data-dim-overall="${w.side}"></g>`;
  }
  // Each fixture's centre from the nearest corner, along its (first) wall — inside the room.
  for (const g of fx) {
    const ow = g.onWalls[0];
    if (!ow || g.f.type === "water_heater") continue;
    const r = unit(sub(ow.w.right, ow.w.left));
    const sc = (ow.s0 + ow.s1) / 2;
    const fromLeft = sc <= ow.w.length_m - sc;
    const [s0, s1] = fromLeft ? [0, sc] : [sc, ow.w.length_m];
    const inside = mul(ow.w.inward, 0.12 * S);
    body += dim(P(add(ow.w.left, mul(r, s0))), P(add(ow.w.left, mul(r, s1))), inside, mm(s1 - s0), `fixture:${g.f.id}:centre-from-${fromLeft ? "left" : "right"}-corner:${ow.w.side}`);
  }

  // Notes + legend column.
  const h = room.ceiling_h_m;
  const legend = [
    `${room.name_en} — internal ${mm(maxX - minX)} × ${mm(maxY - minY)} mm, floor ${room.area_m2.toFixed(2)} m²`,
    `Ceiling height ${mm(h)} mm${room.ceiling_h_source === "measured" ? " (measured)" : " (default — confirm)"}`,
    ...fx.map((g) => `${CODE[g.f.type] ?? g.f.type}  ${NAME[g.f.type] ?? g.f.type}${typeof g.f.spec?.width_mm === "number" ? (typeof g.f.spec.depth_mm === "number" ? ` — ${g.f.spec.width_mm} × ${g.f.spec.depth_mm} mm` : ` — ${g.f.spec.width_mm} mm wide`) : ""}`),
    ...(input.fixtures.some((f) => f.type === "floor_drain") ? ["FD  Floor drain"] : []),
    ...[...new Set(notes)],
    "Dimensions in mm to the finished internal wall face.",
  ];
  let ly = 44;
  body += T(290, 38, "LEGEND & NOTES", { size: 2.8, fill: INK_900, weight: 600 });
  for (const line of legend) {
    body += T(290, ly, line, { size: 2.6, mono: false });
    ly += 5;
  }
  const svg = renderSheet({ meta: { ...input.meta, scale: "1:20" }, sheetNumber: "R-101", title: `${room.name_en} — dimensioned plan`, body, showNorthScale: true, northDeg: input.graph.meta.north_deg, scaleBar: { mmPerM: S, cells: 3, stepM: 1 } });
  return { number: "R-101", title: `${room.name_en} — dimensioned plan`, svg };
}

/** Round only when the design says so; otherwise the common rectangle. */
export function mirrorIsRound(spec: string | null | undefined): boolean {
  return !!spec && /\b(round|circular|circle|oval|pill)\b/i.test(spec) && !/\b(rectangular|rectangle|square)\b/i.test(spec);
}

const SIDE_NAME: Record<string, string> = { wc_point: "WC", bidet_point: "Bidet", basin_point: "Vanity", bath_point: "Bath", storage_cabinet: "Cabinet" };

/** The wall a fixture's back is against: the side whose span is its width along the wall. */
function backWallOf(g: FixtureGeom): FixtureGeom["onWalls"][number] | undefined {
  if (g.onWalls.length <= 1) return g.onWalls[0];
  const fp = footprintOf(g.f.type, g.f.spec);
  if (!fp) return g.onWalls[0];
  const wid = fp.width_mm / 1000;
  return g.onWalls.slice().sort((a, b) => Math.abs(a.s1 - a.s0 - wid) - Math.abs(b.s1 - b.s0 - wid))[0];
}

// --- R-201…: the wall elevations ---------------------------------------------------------------

/** Standard heights (mm) a fitter confirms — every one printed with ≈. */
export const FIXTURE_HEIGHTS_MM = {
  wc_pan: 400,
  wc_cistern_top: 800,
  bidet: 400,
  vanity_underside: 300,
  vanity_top: 850,
  mirror_centre: 1550,
  mirror_d: 700,
  shaver_point: 1450,
  shower_valve: 1100,
  rain_head: 2150,
  niche_bottom: 1100,
  niche_top: 1400,
  heater_bottom: 2100,
  cabinet_top: 850,
  shattaf: 600,
} as const;

/** The setting-out along a wall: joints from the left end, with equal cuts at both ends. */
export function settingOut(lengthMm: number, tileMm: number): { joints: number[]; cut: number; centred: "joint" | "tile" } {
  // Option A: a joint on the centreline. Option B: a tile centred on it.
  const opt = (centreJoint: boolean) => {
    const half = lengthMm / 2;
    const first = centreJoint ? half % tileMm : (half - tileMm / 2) % tileMm;
    const cut = first <= 0 ? tileMm : first;
    const joints: number[] = [];
    for (let x = cut; x < lengthMm - 0.5; x += tileMm) joints.push(Math.round(x));
    return { joints, cut: Math.round(cut), centred: (centreJoint ? "joint" : "tile") as "joint" | "tile" };
  };
  const a = opt(true), b = opt(false);
  return a.cut >= b.cut ? a : b;
}

export function renderRoomElevations(input: RoomSheetsInput): RoomSheet[] {
  const room = input.graph.rooms.find((r) => r.id === input.roomId)!;
  const walls = roomWalls(room);
  const fx = fixtureGeoms(input, walls);
  const H = room.ceiling_h_m;
  const tiled = typeof room.tiled_height_m === "number" ? Math.min(room.tiled_height_m, H) : H;
  const out: RoomSheet[] = [];
  const order = ["North", "East", "South", "West"];
  const sorted = walls.slice().sort((a, b) => order.indexOf(a.side) - order.indexOf(b.side));
  sorted.forEach((w, i) => {
    const Lm = w.length_m;
    const ox = 60, oy = 40 + (190 - H * S) / 2;
    const X = (s: number) => ox + s * S;
    const Y = (z: number) => oy + (H - z) * S;
    let body = "";
    // Tiled band + setting-out.
    const so = settingOut(mm(Lm), input.tile.w_mm);
    body += `<rect x="${n2(X(0))}" y="${n2(Y(tiled))}" width="${n2(Lm * S)}" height="${n2(tiled * S)}" fill="${PAPER_100}" stroke="none" data-tiled-band="${mm(tiled)}"/>`;
    for (const j of so.joints) body += L(X(j / 1000), Y(tiled), X(j / 1000), Y(0), { stroke: INK_100, w: 0.18 });
    const courses: number[] = [];
    for (let z = input.tile.h_mm; z < mm(tiled) - 0.5; z += input.tile.h_mm) courses.push(z);
    for (const z of courses) body += L(X(0), Y(z / 1000), X(Lm), Y(z / 1000), { stroke: INK_100, w: 0.18 });
    const topCut = mm(tiled) - (courses.at(-1) ?? 0);
    // Openings on this wall.
    const ops = openingsOf(input.graph, room.id).filter((o) => wallOf(walls, o.position as V) === w);
    for (const o of ops) {
      const s = along(w, o.position as V).s;
      const s0 = s - o.width_mm / 2000, s1 = s + o.width_mm / 2000;
      const z0 = o.type === "window" ? (o.sill_mm || 0) / 1000 : 0, z1 = z0 + (o.height_mm || 0) / 1000;
      body += `<rect x="${n2(X(s0))}" y="${n2(Y(z1))}" width="${n2((s1 - s0) * S)}" height="${n2((z1 - z0) * S)}" fill="${PAPER}" stroke="${INK_900}" stroke-width="0.35" data-opening="${esc(o.id)}"/>`;
      body += T((X(s0) + X(s1)) / 2, (Y(z0) + Y(z1)) / 2, o.type === "window" ? "WINDOW" : "DOOR", { anchor: "middle", size: 2.4 });
      body += dim([X(s0), Y(z1)], [X(s1), Y(z1)], [0, -3], o.width_mm, `${o.id}.width_mm`);
      if (o.type === "window") body += dim([X(s1), Y(0)], [X(s1), Y(z0)], [4, 0], o.sill_mm, `${o.id}.sill_mm`);
      body += dim([X(s1), Y(z0)], [X(s1), Y(z1)], [o.type === "window" ? 4 : 3, 0], o.height_mm, `${o.id}.height_mm`);
    }
    // Fixtures on this wall, at standard heights.
    const FH = FIXTURE_HEIGHTS_MM;
    const box = (s0: number, s1: number, z0: number, z1: number, label: string, src: string, keyFix: string, dimAt: "top" | "bottom" = "top") => {
      let g = `<rect x="${n2(X(s0))}" y="${n2(Y(z1 / 1000))}" width="${n2((s1 - s0) * S)}" height="${n2(((z1 - z0) / 1000) * S)}" fill="${PAPER}" stroke="${INK_700}" stroke-width="0.3" data-fixture="${esc(keyFix)}"/>`;
      g += T((X(s0) + X(s1)) / 2, Y(z1 / 1000) - 1.2, label, { anchor: "middle", size: 2.3 });
      const zd = dimAt === "top" ? z1 : z0;
      g += dim([X(s0), Y(0)], [X(s0), Y(zd / 1000)], [-3.2, 0], zd, src, { approx: true });
      return g;
    };
    for (const g of fx) {
      const on = g.onWalls.find((x) => x.w === w);
      if (!on) continue;
      const { s0, s1 } = on;
      const sc = (s0 + s1) / 2;
      // A fixture is drawn face-on only on the wall its back is against; on a
      // wall it merely touches by its side it is a profile (no mirror, no shaver).
      if (g.f.type !== "shower_mixer" && backWallOf(g) !== on) {
        const top = g.f.type === "wc_point" ? FH.wc_cistern_top : g.f.type === "bidet_point" ? FH.bidet : g.f.type === "basin_point" ? FH.vanity_top : g.f.type === "bath_point" ? 550 : g.f.type === "storage_cabinet" ? (typeof g.f.spec?.height_mm === "number" ? (g.f.spec.height_mm as number) : FH.cabinet_top) : null;
        const bottom = g.f.type === "basin_point" ? FH.vanity_underside : 0;
        if (top !== null) body += box(s0, s1, bottom, top, `${(SIDE_NAME[g.f.type] ?? g.f.type).toUpperCase()} (SIDE)`, `standard:${g.f.type}_side`, `${g.f.id}:side`);
        continue;
      }
      switch (g.f.type) {
        case "wc_point":
          // The cistern first, so its label is not covered by the pan's fill.
          body += box(s0, s1, FH.wc_pan, FH.wc_cistern_top, "WC", "standard:wc_cistern_top", `${g.f.id}:cistern`) + box(s0, s1, 0, FH.wc_pan, "", "standard:wc_pan", g.f.id);
          break;
        case "bidet_point":
          body += box(s0, s1, 0, FH.bidet, "BIDET", "standard:bidet", g.f.id);
          break;
        case "bath_point":
          body += box(s0, s1, 0, 550, "BATH", "standard:bath", g.f.id);
          break;
        case "basin_point": {
          body += box(s0, s1, FH.vanity_underside, FH.vanity_top, "VANITY", "standard:vanity_top", g.f.id);
          body += dim([X(s1), Y(0)], [X(s1), Y(FH.vanity_underside / 1000)], [3.2, 0], FH.vanity_underside, "standard:vanity_underside", { approx: true });
          const mc = FH.mirror_centre / 1000;
          const round = mirrorIsRound(input.mirror);
          // A round mirror is 700 across; a rectangular one 700 high, 100 narrower than the vanity (max 900).
          const r = round ? FH.mirror_d / 2000 : Math.min(0.9, s1 - s0 - 0.1) / 2;
          body += round
            ? `<circle cx="${n2(X(sc))}" cy="${n2(Y(mc))}" r="${n2(r * S)}" fill="${PAPER}" stroke="${INK_700}" stroke-width="0.3" data-fixture="${esc(g.f.id)}:mirror"/>`
            : `<rect x="${n2(X(sc - r))}" y="${n2(Y(mc + FH.mirror_d / 2000))}" width="${n2(2 * r * S)}" height="${n2((FH.mirror_d / 1000) * S)}" fill="${PAPER}" stroke="${INK_700}" stroke-width="0.3" data-fixture="${esc(g.f.id)}:mirror"/>`;
          body += T(X(sc), Y(mc) + 0.8, "MIRROR", { anchor: "middle", size: 2.3 });
          body += dim([X(sc - r), Y(0)], [X(sc - r), Y(mc)], [-8, 0], FH.mirror_centre, "standard:mirror_centre", { approx: true });
          const sx = Math.min(s1 - 0.05, sc + r + 0.12);
          body += `<rect x="${n2(X(sx) - 1.5)}" y="${n2(Y(FH.shaver_point / 1000) - 1.5)}" width="3" height="3" fill="none" stroke="${INK_700}" stroke-width="0.3" data-fixture="${esc(g.f.id)}:shaver"/>` + T(X(sx) + 2.4, Y(FH.shaver_point / 1000) + 0.8, `SHAVER ≈ ${FH.shaver_point}`, { size: 2.2, attrs: `data-mm="${FH.shaver_point}" data-src="standard:shaver_point" data-approx="true"` });
          break;
        }
        case "shower_mixer": {
          const col = typeof g.f.spec?.column_wall === "string" ? (g.f.spec.column_wall as string).toUpperCase()[0] : null;
          const niche = typeof g.f.spec?.niche_wall === "string" ? (g.f.spec.niche_wall as string).toUpperCase()[0] : null;
          const isCol = col ? w.side[0] === col : on === g.onWalls[0];
          const isNiche = niche ? w.side[0] === niche : on === g.onWalls[0];
          body += L(X(s0), Y(0), X(s0), Y(2.0), { stroke: INK_700, w: 0.3, dash: "1.2 0.8" }) + L(X(s1), Y(0), X(s1), Y(2.0), { stroke: INK_700, w: 0.3, dash: "1.2 0.8" }) + T((X(s0) + X(s1)) / 2, Y(0.15), "SHOWER", { anchor: "middle", size: 2.3 });
          if (isCol) {
            body += `<circle cx="${n2(X(sc))}" cy="${n2(Y(FH.shower_valve / 1000))}" r="1.6" fill="none" stroke="${INK_900}" stroke-width="0.3" data-fixture="${esc(g.f.id)}:valve"/>` + T(X(sc) + 2.4, Y(FH.shower_valve / 1000) + 0.8, "VALVE", { size: 2.2 });
            body += dim([X(sc), Y(0)], [X(sc), Y(FH.shower_valve / 1000)], [-3.2, 0], FH.shower_valve, "standard:shower_valve", { approx: true });
            body += `<rect x="${n2(X(sc) - 4)}" y="${n2(Y(FH.rain_head / 1000) - 0.6)}" width="8" height="1.2" fill="${INK_700}" data-fixture="${esc(g.f.id)}:rain_head"/>` + T(X(sc) + 5, Y(FH.rain_head / 1000) + 0.8, `RAIN HEAD ≈ ${FH.rain_head}`, { size: 2.2, attrs: `data-mm="${FH.rain_head}" data-src="standard:rain_head" data-approx="true"` });
          }
          if (isNiche) {
            const nc = sc + (isCol ? 0.35 : 0), nw = 0.3;
            body += `<rect x="${n2(X(nc - nw))}" y="${n2(Y(FH.niche_top / 1000))}" width="${n2(nw * 2 * S)}" height="${n2(((FH.niche_top - FH.niche_bottom) / 1000) * S)}" fill="none" stroke="${INK_700}" stroke-width="0.3" stroke-dasharray="0.8 0.6" data-fixture="${esc(g.f.id)}:niche"/>` + T(X(nc), Y(FH.niche_top / 1000) - 1.2, `NICHE ≈ ${FH.niche_bottom}–${FH.niche_top}`, { anchor: "middle", size: 2.2, attrs: `data-mm="${FH.niche_bottom}" data-src="standard:niche_bottom" data-approx="true"` });
          }
          break;
        }
        case "storage_cabinet":
          body += box(s0, s1, 0, typeof g.f.spec?.height_mm === "number" ? (g.f.spec.height_mm as number) : FH.cabinet_top, "STORAGE CABINET", typeof g.f.spec?.height_mm === "number" ? "fixture.spec.height_mm" : "standard:cabinet_top", g.f.id);
          break;
        case "shattaf_point": {
          const z = FH.shattaf / 1000;
          body += `<circle cx="${n2(X(sc))}" cy="${n2(Y(z))}" r="1.3" fill="none" stroke="${INK_900}" stroke-width="0.3" data-fixture="${esc(g.f.id)}"/>` + T(X(sc), Y(z) - 2.4, `SHATTAF ≈ ${FH.shattaf}`, { size: 2.2, anchor: "middle", attrs: `data-mm="${FH.shattaf}" data-src="standard:shattaf" data-approx="true"` });
          break;
        }
        case "water_heater": {
          const z0 = typeof g.f.spec?.height_mm === "number" ? (g.f.spec.height_mm as number) : FH.heater_bottom;
          body += box(s0, s1, z0, Math.min(z0 + 400, mm(H)), "WATER HEATER (EXISTING)", typeof g.f.spec?.height_mm === "number" ? "fixture.spec.height_mm" : "standard:heater_bottom", g.f.id, "bottom");
          break;
        }
      }
    }
    // The wall outline, floor and ceiling.
    body += `<rect x="${n2(X(0))}" y="${n2(Y(H))}" width="${n2(Lm * S)}" height="${n2(H * S)}" fill="none" stroke="${INK_900}" stroke-width="0.5" data-elevation="${w.side}"/>`;
    body += L(X(0) - 6, Y(0), X(Lm) + 6, Y(0), { stroke: INK_900, w: 0.5 });
    // Overall dims: length below, ceiling height left, tiled height + setting-out.
    body += dim([X(0), Y(0)], [X(Lm), Y(0)], [0, 12], mm(Lm), `${w.side}:length`, { key: `wall:${w.side}` });
    body += dim([X(0), Y(0)], [X(0), Y(H)], [-12, 0], mm(H), "room.ceiling_h_m", { key: "ceiling" });
    if (tiled < H) body += dim([X(Lm), Y(0)], [X(Lm), Y(tiled)], [12, 0], mm(tiled), "room.tiled_height_m", { key: "tiled" });
    // The setting-out: the two end cuts and one full tile, dimensioned under the floor line.
    // Joint to joint, so the tiler's chain closes on the wall's length.
    const stops = [0, ...so.joints, mm(Lm)];
    for (let j = 0; j + 1 < stops.length; j++) {
      const a = stops[j]!, b = stops[j + 1]!;
      const what = j === 0 ? { src: "setting-out:cut-left", key: `cut-left:${w.side}` } : j === stops.length - 2 ? { src: "setting-out:cut-right", key: `cut-right:${w.side}` } : { src: "tile.w_mm", key: `tile:${w.side}:${j}` };
      body += dim([X(a / 1000), Y(0)], [X(b / 1000), Y(0)], [0, 6], b - a, what.src, { key: what.key });
    }
    body += dim([X(Lm), Y(courses.at(-1)! / 1000 || 0)], [X(Lm), Y(tiled)], [5, 0], topCut, "setting-out:top-cut", { key: `top-cut:${w.side}` });
    // Notes.
    const notes = [
      `${w.side} wall, seen from inside the room — internal length ${mm(Lm)} mm, ceiling ${mm(H)} mm.`,
      `Tiled ${tiled >= H - 1e-9 ? "to full height" : `to ${mm(tiled)} mm`}: ${input.tile.w_mm} × ${input.tile.h_mm} mm${input.tile.source === "assumed" ? " (assumed — confirm the tile)" : ""}, ${so.centred === "joint" ? "a joint" : "a tile"} on the wall's centreline, equal cuts ${so.cut} mm at both ends; courses from the floor, top course cut to ${topCut} mm.`,
      "Fixture heights (≈) are standard heights — confirm with the fitter before tiling.",
      "Dimensions in mm to the finished internal faces.",
    ];
    let ly = 40;
    body += T(290, 36, "NOTES", { size: 2.8, fill: INK_900, weight: 600 });
    for (const n of notes) {
      for (const line of wrap(n, 46)) {
        body += T(290, ly, line, { size: 2.6, mono: false });
        ly += 4.4;
      }
      ly += 1.6;
    }
    const number = `R-${201 + i}`;
    const title = `${room.name_en} — ${w.side.toLowerCase()} wall elevation`;
    out.push({ number, title, svg: renderSheet({ meta: { ...input.meta, scale: "1:20" }, sheetNumber: number, title, body, showNorthScale: false }) });
  });
  return out;
}

function wrap(s: string, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const word of s.split(/\s+/)) {
    if ((cur + " " + word).trim().length > max) {
      out.push(cur);
      cur = word;
    } else cur = (cur + " " + word).trim();
  }
  if (cur) out.push(cur);
  return out;
}

/** The tile as laid on the walls: a size the design spec names, else 600 × 1200 portrait (room sheet §6), assumed. */
export function wallTileFrom(specText: string | null | undefined): RoomSheetsInput["tile"] {
  const m = specText ? /(\d{3,4})\s*[×x]\s*(\d{3,4})/.exec(specText) : null;
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    return { w_mm: Math.min(a, b), h_mm: Math.max(a, b), source: "design" };
  }
  return { w_mm: 600, h_mm: 1200, source: "assumed" };
}

/** R-101 + one elevation per wall. */
export function roomSheets(input: RoomSheetsInput): RoomSheet[] {
  return [renderRoomPlan(input), ...renderRoomElevations(input)];
}

// =============================================================================
// lib/drawings/garden-elevations.ts — eye-level drawings for a garden (G4b).
//
//   L-3nn  Sectional elevation per structure — pergola, counters, benches,
//          planter runs, wall features, planter boxes — with heights, build-up
//          and FFL levels, KAME-pack style, each view at its own fitted scale
//          (1:10 – 1:50, printed on the view).
//   L-501  Whole-garden elevation strips — the boundary wall line with the
//          structures in profile.
//
// Every figure comes from the graph. Each vertical or horizontal dimension and
// each level tag carries `data-src`: an expression over graph fields (e.g.
// `room:z-pergola:height_mm - room:z-pergola:spec.beam_depth_mm`). A test
// resolves it independently and checks the printed number, so a sheet cannot
// print a height the plan does not hold. A value the plan marks as assumed
// (a boundary wall scaled off a section) is drawn with `data-derived` and says
// so in the notes.
//
// Deterministic SVG. No LLM, no DOM.
// =============================================================================

import { isNewWork } from "@/lib/plan/site-reference";
import { LINEAR_ELEMENT_META, type LinearElement } from "@/lib/plan/elements";
import type { ContextVolume, PlanGraph, Point, Room } from "@/lib/plan/geometry";

import type { GardenFixture } from "./garden-sheets";
import { bboxOf, fmtLevel, gardenZones, levelUnder, toMetres, zoneAtPoint } from "./garden-sheets";

export { fmtLevel };
import {
  BONE,
  esc,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_UI,
  INK_100,
  INK_500,
  INK_700,
  INK_900,
  PAPER,
  renderSheet,
  SHEET_H,
  SHEET_MARGIN,
  SHEET_W,
  TERRACOTTA,
  type SheetMeta,
} from "./sheet";

const f2 = (n: number) => n.toFixed(2);
/** data-src expression: terms joined by space-delimited operators (ids contain hyphens). */
const add = (...t: string[]) => t.join(" + ");
const sub = (a: string, ...t: string[]) => [a, ...t].join(" - ");
const mmOf = (m: number) => Math.round(m * 1000);

export interface ElevationSheet {
  kind: "structure_elevation" | "garden_elevation";
  title: string;
  sheetNumber: string;
  /** What the sheet draws: a room, element or unit id, or "garden". */
  subject: string;
  svg: string;
}

// --- Numbers ---------------------------------------------------------------------



// --- Layout ----------------------------------------------------------------------

const PANEL_W = 104;
const panelX = () => SHEET_W - SHEET_MARGIN - PANEL_W;
const AREA = { x: SHEET_MARGIN + 16, y: SHEET_MARGIN + 14, w: SHEET_W - SHEET_MARGIN - PANEL_W - 14 - (SHEET_MARGIN + 16), h: SHEET_H - SHEET_MARGIN * 2 - 14 - 26 };
const ELEV_SCALES = [10, 20, 25, 50, 75, 100] as const;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface EFrame {
  denom: number;
  k: number;
  /** Paper x for a horizontal coordinate in metres. */
  px: (u: number) => number;
  /** Paper y for a height in metres (up is up). */
  pz: (z: number) => number;
}

/** Paper room a view keeps round its geometry: dims left/below, level tags right. */
const PAD = { left: 20, right: 26, top: 8, bottom: 20, title: 9 };

/** Fit a view of (u0..u1) × (z0..z1) metres into a box at the most detailed standard scale. */
function efit(u0: number, u1: number, z0: number, z1: number, box: Box): EFrame {
  const wM = u1 - u0;
  const hM = z1 - z0;
  const availW = box.w - PAD.left - PAD.right;
  const availH = box.h - PAD.top - PAD.bottom - PAD.title;
  const d = ELEV_SCALES.find((s) => (wM * 1000) / s <= availW && (hM * 1000) / s <= availH) ?? 100;
  const k = 1000 / d;
  const ox = box.x + PAD.left + (availW - wM * k) / 2 - u0 * k;
  const baseY = box.y + PAD.top + availH - (availH - hM * k) / 2 + z0 * k;
  return { denom: d, k, px: (u) => ox + u * k, pz: (z) => baseY - z * k };
}

/** The box under the notes panel, for a sheet's secondary view. */
function sideBox(panelBottom: number): Box {
  const y = panelBottom + 4;
  return { x: panelX() - 6, y, w: PANEL_W + 6, h: SHEET_H - SHEET_MARGIN - 54 - 4 - y };
}

// --- Primitives --------------------------------------------------------------------

function rectU(f: EFrame, u0: number, u1: number, z0: number, z1: number, fill = PAPER, stroke = INK_900, sw = 0.35, extra = ""): string {
  const x = f.px(Math.min(u0, u1));
  const y = f.pz(Math.max(z0, z1));
  return `<rect x="${f2(x)}" y="${f2(y)}" width="${f2(Math.abs(u1 - u0) * f.k)}" height="${f2(Math.abs(z1 - z0) * f.k)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${extra}/>`;
}

function ground(f: EFrame, u0: number, u1: number, z: number): string {
  const y = f.pz(z);
  let s = `<line x1="${f2(f.px(u0))}" y1="${f2(y)}" x2="${f2(f.px(u1))}" y2="${f2(y)}" stroke="${INK_900}" stroke-width="0.5"/>`;
  for (let u = u0; u < u1; u += 0.12 * (f.denom / 20)) {
    const x = f.px(u);
    s += `<line x1="${f2(x)}" y1="${f2(y + 0.4)}" x2="${f2(x - 1.6)}" y2="${f2(y + 2)}" stroke="${INK_500}" stroke-width="0.15"/>`;
  }
  return s;
}

const TICK = 1;

/** Horizontal dimension between u0 and u1, `off` mm below (positive) or above (negative) the reference z. */
function hDim(f: EFrame, u0: number, u1: number, z: number, off: number, kind: string, src: string, opts: { derived?: boolean } = {}): string {
  const mm = mmOf(u1 - u0);
  const y = f.pz(z) + off;
  const x0 = f.px(u0), x1 = f.px(u1);
  const tick = (x: number) => `<line x1="${f2(x - TICK)}" y1="${f2(y + TICK)}" x2="${f2(x + TICK)}" y2="${f2(y - TICK)}" stroke="${INK_500}" stroke-width="0.25"/>`;
  return (
    `<line x1="${f2(x0)}" y1="${f2(f.pz(z))}" x2="${f2(x0)}" y2="${f2(y)}" stroke="${INK_100}" stroke-width="0.18"/>` +
    `<line x1="${f2(x1)}" y1="${f2(f.pz(z))}" x2="${f2(x1)}" y2="${f2(y)}" stroke="${INK_100}" stroke-width="0.18"/>` +
    `<line x1="${f2(x0)}" y1="${f2(y)}" x2="${f2(x1)}" y2="${f2(y)}" stroke="${INK_500}" stroke-width="0.25"/>` +
    tick(x0) +
    tick(x1) +
    `<text x="${f2((x0 + x1) / 2)}" y="${f2(y - 1)}" text-anchor="middle" font-size="2.3" fill="${INK_700}" style="font-family:${FONT_MONO}" data-dim="${kind}" data-axis="h" data-mm="${mm}" data-src="${esc(src)}"${opts.derived ? ' data-derived="true"' : ""}>${mm}</text>`
  );
}

/** Vertical dimension from z0 to z1 at horizontal position u, `off` mm left (negative) or right. */
function vDim(f: EFrame, u: number, z0: number, z1: number, off: number, kind: string, src: string, opts: { derived?: boolean } = {}): string {
  const mm = mmOf(z1 - z0);
  const x = f.px(u) + off;
  const y0 = f.pz(z0), y1 = f.pz(z1);
  const tick = (y: number) => `<line x1="${f2(x - TICK)}" y1="${f2(y + TICK)}" x2="${f2(x + TICK)}" y2="${f2(y - TICK)}" stroke="${INK_500}" stroke-width="0.25"/>`;
  const tx = x - 1.2;
  const ty = (y0 + y1) / 2;
  return (
    `<line x1="${f2(f.px(u))}" y1="${f2(y0)}" x2="${f2(x)}" y2="${f2(y0)}" stroke="${INK_100}" stroke-width="0.18"/>` +
    `<line x1="${f2(f.px(u))}" y1="${f2(y1)}" x2="${f2(x)}" y2="${f2(y1)}" stroke="${INK_100}" stroke-width="0.18"/>` +
    `<line x1="${f2(x)}" y1="${f2(y0)}" x2="${f2(x)}" y2="${f2(y1)}" stroke="${INK_500}" stroke-width="0.25"/>` +
    tick(y0) +
    tick(y1) +
    `<text x="${f2(tx)}" y="${f2(ty)}" text-anchor="middle" font-size="2.3" fill="${INK_700}" style="font-family:${FONT_MONO}" transform="rotate(-90 ${f2(tx)} ${f2(ty)})" data-dim="${kind}" data-axis="v" data-mm="${mm}" data-src="${esc(src)}"${opts.derived ? ' data-derived="true"' : ""}>${mm}</text>`
  );
}

/** A level tag: datum triangle on a leader, e.g. "+2800 TRL". */
function levelTag(f: EFrame, u: number, z: number, code: string, src: string, opts: { right?: boolean; derived?: boolean } = {}): string {
  const x = f.px(u);
  const y = f.pz(z);
  const dir = opts.right ? 1 : -1;
  const lx = x + dir * 12;
  const mm = mmOf(z);
  return (
    `<line x1="${f2(x)}" y1="${f2(y)}" x2="${f2(lx)}" y2="${f2(y)}" stroke="${INK_500}" stroke-width="0.2" stroke-dasharray="0.8 0.6"/>` +
    `<polygon points="${f2(lx - 1.2)},${f2(y - 1.8)} ${f2(lx + 1.2)},${f2(y - 1.8)} ${f2(lx)},${f2(y)}" fill="${INK_900}"/>` +
    `<text x="${f2(lx + dir * 2)}" y="${f2(y - 0.7)}" text-anchor="${opts.right ? "start" : "end"}" font-size="2.3" fill="${INK_900}" style="font-family:${FONT_MONO}" data-level="${mm}" data-src="${esc(src)}"${opts.derived ? ' data-derived="true"' : ""}>${fmtLevel(mm)} ${code}</text>`
  );
}

function viewTitle(box: Box, title: string, denom: number): string {
  return `<text x="${f2(box.x)}" y="${f2(box.y + box.h - 3)}" font-size="3" fill="${INK_900}" style="font-family:${FONT_UI};font-weight:600;letter-spacing:0.04em">${esc(title.toUpperCase())}</text><text x="${f2(box.x)}" y="${f2(box.y + box.h + 0.8)}" font-size="2.3" fill="${INK_500}" style="font-family:${FONT_MONO}">Scale 1:${denom} @ A3</text>`;
}

function panelHeading(y: number, text: string): string {
  return `<text x="${panelX()}" y="${f2(y)}" font-size="3" fill="${INK_900}" style="font-family:${FONT_UI};font-weight:600;letter-spacing:0.05em">${esc(text.toUpperCase())}</text><line x1="${panelX()}" y1="${f2(y + 1.4)}" x2="${panelX() + PANEL_W}" y2="${f2(y + 1.4)}" stroke="${BONE}" stroke-width="0.35"/>`;
}

function wrap(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/)) {
    if ((cur + " " + w).trim().length > maxChars) {
      if (cur) out.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}

function panelText(y: number, text: string, color = INK_700, size = 2.3): { svg: string; y: number } {
  const lines = wrap(text, 68);
  return {
    svg: lines.map((l, i) => `<text x="${panelX()}" y="${f2(y + i * size * 1.35)}" font-size="${size}" fill="${color}" style="font-family:${FONT_UI}">${esc(l)}</text>`).join(""),
    y: y + lines.length * size * 1.35,
  };
}

function sheet(meta: SheetMeta, number: string, title: string, body: string, scales: number[]): string {
  const uniq = [...new Set(scales)].sort((a, b) => a - b);
  return renderSheet({
    meta: { ...meta, scale: uniq.map((d) => `1:${d}`).join(" / "), level: "Ground (external works)" },
    sheetNumber: number,
    title,
    body,
    showNorthScale: false,
  });
}

/** Notes panel shared by every structure sheet. */
function notesPanel(title: string, facts: [string, string][], notes: { text: string; color?: string }[]): { svg: string; y: number } {
  let y = SHEET_MARGIN + 8;
  let s = `<text x="${panelX()}" y="${f2(y + 2)}" font-size="5" fill="${INK_900}" style="font-family:${FONT_DISPLAY}">${esc(title)}</text>`;
  y += 10;
  s += panelHeading(y, "Build-up");
  y += 5;
  for (const [k, v] of facts) {
    s += `<text x="${panelX()}" y="${f2(y)}" font-size="2.4" fill="${INK_500}" style="font-family:${FONT_UI}">${esc(k)}</text><text x="${panelX() + PANEL_W}" y="${f2(y)}" text-anchor="end" font-size="2.4" fill="${INK_900}" style="font-family:${FONT_MONO}">${esc(v)}</text>`;
    y += 3.6;
  }
  y += 3;
  s += panelHeading(y, "Levels");
  y += 5;
  for (const [c, l] of [["FFL", "Finished floor level"], ["TRL", "Top of roof level"], ["CTL", "Counter top level"], ["TOC", "Top of coping"]]) {
    s += `<text x="${panelX()}" y="${f2(y)}" font-size="2.4" fill="${INK_900}" style="font-family:${FONT_MONO}">${c}</text><text x="${panelX() + 12}" y="${f2(y)}" font-size="2.4" fill="${INK_700}" style="font-family:${FONT_UI}">${l}</text>`;
    y += 3.4;
  }
  y += 3;
  s += panelHeading(y, "Notes");
  y += 5;
  for (const n of [{ text: "All dimensions in millimetres. Levels relative to ±000 FFL of the paving the structure stands on." }, ...notes]) {
    const t = panelText(y, n.text, n.color ?? INK_700);
    s += t.svg;
    y = t.y + 1.6;
  }
  return { svg: s, y };
}

// --- Graph lookups ---------------------------------------------------------------------

export const zoneAt = zoneAtPoint;
const baseLevel = levelUnder;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function spec(o: { spec: Record<string, unknown> | null } | { spec?: Record<string, unknown> | null }): Record<string, unknown> {
  return (o.spec ?? {}) as Record<string, unknown>;
}

/** Segment i of a run: endpoints, length, unit direction, right-hand normal (plan x east, y south). */
export function runSegments(el: LinearElement) {
  const out: { a: Point; b: Point; len: number; dir: Point; normal: Point }[] = [];
  for (let i = 0; i < el.polyline.length - 1; i++) {
    const a = el.polyline[i]!;
    const b = el.polyline[i + 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const dir: Point = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    out.push({ a, b, len, dir, normal: [-dir[1], dir[0]] });
  }
  return out;
}

/** Where a run's width sits across its polyline, metres, right of travel positive. */
export function runBand(el: LinearElement): [number, number] {
  const b = spec(el).band_mm;
  if (Array.isArray(b) && typeof b[0] === "number" && typeof b[1] === "number") return [b[0] / 1000, b[1] / 1000];
  return [-el.width_mm / 2000, el.width_mm / 2000];
}

/** Structures that get an elevation sheet, in sheet order. */
export function elevationSubjects(graph: PlanGraph, fixtures: readonly GardenFixture[], variants: Record<string, string | null> = {}) {
  // G5: an elevation details what gets BUILT. An existing item that is kept (or
  // not yet decided) is surveyed context, not a construction detail — and a
  // stepping-stone path or a string light run has no section worth drawing.
  const structures = gardenZones(graph).filter((z) => z.type === "structure" && z.height_mm != null && isNewWork(z));
  const order: Record<string, number> = { counter_run: 0, bench_run: 1, planter_run: 2 };
  const runs = graph.elements
    .filter((e) => e.kind !== "boundary_wall" && e.kind !== "stepping_path" && e.kind !== "string_light_run" && isNewWork(e))
    .slice()
    // Sheet numbers must not depend on database ids: kind, then BBQ before bar,
    // then position on the plan (north to south, west to east).
    .sort((a, b) => {
      const vo: Record<string, number> = { bbq: 0, bar: 1 };
      const pa = a.polyline[0]!, pb = b.polyline[0]!;
      return (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || (vo[variants[a.id] ?? ""] ?? 2) - (vo[variants[b.id] ?? ""] ?? 2) || pa[1] - pb[1] || pa[0] - pb[0];
    });
  const unitOrder: Record<string, number> = { wall_feature: 0, planter_box: 1 };
  const units = fixtures
    .filter((u) => u.layer === "landscape" && (u.type === "wall_feature" || u.type === "planter_box") && num(spec(u).height_mm) != null && isNewWork({ site_reference: u.site_reference ?? false, disposition: u.disposition ?? null }))
    .slice()
    .sort((a, b) => (unitOrder[a.type] ?? 9) - (unitOrder[b.type] ?? 9) || a.position[1] - b.position[1] || a.position[0] - b.position[0]);
  return { structures, runs, units };
}

const VARIANT_TITLE: Record<string, string> = { bbq: "BBQ counter", bar: "Bar counter" };

// --- L-3nn: pergola ----------------------------------------------------------------------

function pergolaSheet(graph: PlanGraph, zone: Room, meta: SheetMeta, number: string): ElevationSheet {
  const s = spec(zone);
  const id = zone.id;
  const R = (f: string) => `room:${id}:${f}`;
  const b = bboxOf(zone.polygon);
  const level = (zone.level_mm ?? 0) / 1000;
  const H = zone.height_mm! / 1000;
  const member = (num(s.member_mm) ?? 150) / 1000;
  const beam = (num(s.beam_depth_mm) ?? 150) / 1000;
  const posts = (Array.isArray(s.posts_mm) ? s.posts_mm : []) as [number, number][];
  const postU = [...new Set(posts.map((p) => p[0]))].sort((a, c) => a - c);
  const postV = [...new Set(posts.map((p) => p[1]))].sort((a, c) => a - c);
  const beamsX = (Array.isArray(s.beams_x_mm) ? s.beams_x_mm : []) as number[];
  const beamsY = (Array.isArray(s.beams_y_mm) ? s.beams_y_mm : []) as number[];
  const W = b.maxX - b.minX;
  const D = b.maxY - b.minY;

  const panel = notesPanel(
    zone.name_en,
    [
      ["System", String(s.system ?? "Pergola").replace("Motorised aluminium ", "Alum. ")],
      ["Plan", `${mmOf(W)} × ${mmOf(D)}`],
      ["Top (TRL)", fmtLevel(zone.level_mm! + zone.height_mm!)],
      ["Clear height", String(zone.height_mm! - mmOf(beam))],
      ["Members", `${mmOf(member)} × ${mmOf(member)}`],
      ["Posts", String(posts.length)],
    ],
    [
      { text: `Heights: ${String(s.height_source ?? "not sourced")}. Levels: ${String(s.level_source ?? "not sourced")}.` },
      { text: "Louvres and integral downlights are part of the pergola system; set out by the supplier." },
    ],
  );
  const topBox: Box = AREA;
  const botBox: Box = sideBox(panel.y);
  let body = panel.svg;
  const scales: number[] = [];

  // Elevation looking north: u = x across the zone.
  {
    const f = efit(-0.1, W + 0.1, level, level + H, topBox);
    scales.push(f.denom);
    body += ground(f, -0.4, W + 0.4, level);
    for (const off of postU) body += rectU(f, off / 1000, off / 1000 + member, level, level + H, BONE, INK_900, 0.35);
    body += rectU(f, 0, W, level + H - beam, level + H, BONE, INK_900, 0.35);
    // Louvres between the N–S beams, seen end-on under the south beam.
    for (let i = 0; i < beamsX.length - 1; i++) {
      const u0 = beamsX[i]! / 1000 + member;
      const u1 = beamsX[i + 1]! / 1000;
      for (let u = u0 + 0.06; u < u1 - 0.04; u += 0.11) {
        body += `<line x1="${f2(f.px(u))}" y1="${f2(f.pz(level + H - beam + 0.02))}" x2="${f2(f.px(u))}" y2="${f2(f.pz(level + H - 0.02))}" stroke="${INK_500}" stroke-width="0.15"/>`;
      }
    }
    // Horizontal chain: edge → post → gap → post → edge, then overall.
    let cursor = 0;
    let cursorTerms: string[] = [];
    postU.forEach((off) => {
      const t = R(`spec.posts_mm.${posts.findIndex((p) => p[0] === off)}.0`);
      if (off / 1000 - cursor > 0.01) body += hDim(f, cursor, off / 1000, level, 7, "pergola-bay", cursorTerms.length ? sub(t, ...cursorTerms) : t);
      body += hDim(f, off / 1000, off / 1000 + member, level, 7, "pergola-post", R("spec.member_mm"));
      cursor = off / 1000 + member;
      cursorTerms = [t, R("spec.member_mm")];
    });
    if (W - cursor > 0.01) body += hDim(f, cursor, W, level, 7, "pergola-bay", sub(R("bboxw"), ...cursorTerms));
    body += hDim(f, 0, W, level, 14, "pergola-width", R("bboxw"));
    // Vertical: overall height, beam depth, clear height.
    body += vDim(f, 0, level, level + H, -16, "pergola-height", R("height_mm"));
    body += vDim(f, W, level, level + H - beam, 8, "pergola-clear", sub(R("height_mm"), R("spec.beam_depth_mm")));
    body += vDim(f, W, level + H - beam, level + H, 8, "pergola-beam", R("spec.beam_depth_mm"));
    body += levelTag(f, -0.4, level, "FFL", R("level_mm"));
    body += levelTag(f, W + 0.4, level + H, "TRL", add(R("level_mm"), R("height_mm")), { right: true });
    body += levelTag(f, W + 0.4, level + H - beam, "USB", sub(add(R("level_mm"), R("height_mm")), R("spec.beam_depth_mm")), { right: true });
    body += viewTitle(topBox, "Sectional elevation A — looking north", f.denom);
  }
  // Section looking west: u = distance from the north edge.
  {
    const f = efit(-0.1, D + 0.1, level, level + H, botBox);
    scales.push(f.denom);
    body += ground(f, -0.4, D + 0.4, level);
    for (const off of postV) body += rectU(f, off / 1000, off / 1000 + member, level, level + H, BONE, INK_900, 0.35);
    // Beams running E–W are cut: small squares.
    for (const off of beamsY) body += rectU(f, off / 1000, off / 1000 + member, level + H - beam, level + H, INK_700, INK_900, 0.3);
    body += `<line x1="${f2(f.px(0))}" y1="${f2(f.pz(level + H - beam / 2))}" x2="${f2(f.px(D))}" y2="${f2(f.pz(level + H - beam / 2))}" stroke="${INK_500}" stroke-width="0.2" stroke-dasharray="1 0.8"/>`;
    for (let i = 0; i < beamsY.length - 1; i++) {
      body += hDim(f, beamsY[i]! / 1000, beamsY[i + 1]! / 1000, level + H, -6, "pergola-beam-spacing", sub(R(`spec.beams_y_mm.${i + 1}`), R(`spec.beams_y_mm.${i}`)));
    }
    body += hDim(f, 0, D, level, 8, "pergola-depth", R("bboxh"));
    body += vDim(f, 0, level, level + H, -10, "pergola-height", R("height_mm"));
    body += levelTag(f, D + 0.4, level, "FFL", R("level_mm"), { right: true });
    body += viewTitle(botBox, "Section B — looking west", f.denom);
  }

  return { kind: "structure_elevation", title: `Sectional Elevation — ${zone.name_en}`, sheetNumber: number, subject: id, svg: sheet(meta, number, `Sectional Elevation — ${zone.name_en}`, body, scales) };
}

// --- L-3nn: runs (counters, benches, planters) ----------------------------------------------

function runSheet(graph: PlanGraph, el: LinearElement, meta: SheetMeta, number: string, variant: string | null): ElevationSheet {
  const s = spec(el);
  const E = (f: string) => `el:${el.id}:${f}`;
  const segs = runSegments(el);
  const [o0, o1] = runBand(el);
  const mid = segs[0] ? ([(segs[0].a[0] + segs[0].b[0]) / 2, (segs[0].a[1] + segs[0].b[1]) / 2] as Point) : ([0, 0] as Point);
  const base = baseLevel(graph, mid);
  const lv = base.mm / 1000;
  const H = el.height_mm / 1000;
  const meta0 = LINEAR_ELEMENT_META[el.kind];
  const name = el.kind === "counter_run" ? (VARIANT_TITLE[variant ?? ""] ?? "Counter run") : meta0.label;
  const code = el.kind === "counter_run" ? "CTL" : el.kind === "planter_run" ? "TOC" : "TOS";
  const planter = el.kind === "bench_run" ? graph.elements.find((p) => p.kind === "planter_run" && runSegments(p).some((ps) => segs.some((bs) => Math.hypot(ps.a[0] - bs.a[0], ps.a[1] - bs.a[1]) < 0.6))) : undefined;

  const facts: [string, string][] = [
    ["Length", segs.map((g) => String(mmOf(g.len))).join(" + ")],
    ["Width", String(el.width_mm)],
    ["Height", String(el.height_mm)],
  ];
  for (const k of ["top_slab_mm", "cabinet_mm", "plinth_mm", "body_mm", "cladding_mm", "kerb_mm", "support_mm"]) {
    const v = num(s[k]);
    if (v) facts.push([k.replace("_mm", "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), String(v)]);
  }
  const notes: { text: string; color?: string }[] = [{ text: `Source: ${String(s.source ?? "not sourced")}.` }];
  if (!base.stated) notes.push({ text: "The plan states no level for the ground under this run; heights are shown from an assumed ±000.", color: TERRACOTTA });
  if (el.derived) notes.push({ text: "Cross-section defaulted, not measured.", color: TERRACOTTA });
  const panel = notesPanel(name, facts, notes);

  const nViews = segs.length;
  const elevH = AREA.h / Math.max(nViews, 2);
  let body = panel.svg;
  const scales: number[] = [];
  const topOf = (i: number): Box => ({ x: AREA.x, y: AREA.y + i * elevH, w: AREA.w, h: elevH });

  segs.forEach((seg, i) => {
    const box = topOf(i);
    const f = efit(-0.05, seg.len + 0.05, lv, lv + Math.max(H, 0.6), box);
    scales.push(f.denom);
    body += ground(f, -0.3, seg.len + 0.3, lv);
    body += rectU(f, 0, seg.len, lv, lv + H, BONE, INK_900, 0.35);
    const plinth = num(s.plinth_mm);
    const slab = num(s.top_slab_mm);
    const cabinet = num(s.cabinet_mm);
    if (plinth) body += `<line x1="${f2(f.px(0))}" y1="${f2(f.pz(lv + plinth / 1000))}" x2="${f2(f.px(seg.len))}" y2="${f2(f.pz(lv + plinth / 1000))}" stroke="${INK_500}" stroke-width="0.2"/>`;
    if (slab) body += rectU(f, 0, seg.len, lv + H - slab / 1000, lv + H, PAPER, INK_900, 0.35);
    if (el.kind === "counter_run" && num(s.support_mm) && !cabinet) {
      // A slab on end supports: hollow between.
      const sup = num(s.support_mm)! / 1000;
      body += rectU(f, sup, seg.len - sup, lv, lv + H - (slab ?? 0) / 1000, PAPER, INK_500, 0.2, ' stroke-dasharray="1 0.8"');
    }
    body += hDim(f, 0, seg.len, lv, 7, `${el.kind}-length`, E(`seg${i}`));
    if (i === 0) {
      body += vDim(f, 0, lv, lv + H, -12, `${el.kind}-height`, E("height_mm"));
      let z = lv;
      const below: string[] = [];
      for (const [key, v] of [["plinth_mm", plinth], ["cabinet_mm", cabinet], ["body_mm", num(s.body_mm)]] as const) {
        if (!v) continue;
        body += vDim(f, seg.len, z, z + v / 1000, 6, `${el.kind}-${key.replace("_mm", "")}`, E(`spec.${key}`));
        z += v / 1000;
        below.push(E(`spec.${key}`));
      }
      if (slab && z > lv) body += vDim(f, seg.len, z, lv + H, 6, `${el.kind}-top`, sub(E("height_mm"), ...below));
      else if (slab) body += vDim(f, seg.len, lv + H - slab / 1000, lv + H, 6, `${el.kind}-top-slab`, E("spec.top_slab_mm"));
      body += levelTag(f, -0.3, lv, "FFL", base.src);
      body += levelTag(f, seg.len + 0.3, lv + H, code, add(base.src, E("height_mm")), { right: true });
    }
    body += viewTitle(box, nViews > 1 ? `Elevation ${String.fromCharCode(65 + i)} — leg ${i + 1}` : "Elevation A", f.denom);
  });

  // Cross-section through the band.
  {
    const secBox: Box = sideBox(panel.y);
    const pH = planter ? planter.height_mm / 1000 : 0;
    const [p0, p1] = planter ? runBand(planter) : [0, 0];
    const umin = Math.min(o0, planter ? p0 : o0) - 0.25;
    const umax = Math.max(o1, planter ? p1 : o1) + 0.25;
    const f = efit(umin, umax, lv, lv + Math.max(H, pH), secBox);
    scales.push(f.denom);
    body += ground(f, umin, umax, lv);
    if (planter) {
      const ps = spec(planter);
      const kb = Array.isArray(ps.kerb_band_mm) ? (ps.kerb_band_mm as number[]).map((v) => v / 1000) : [p1 - 0.1, p1];
      body += rectU(f, p0, kb[0]!, lv, lv + pH - 0.05, "#E8E1CF", INK_500, 0.2);
      body += `<text x="${f2(f.px((p0 + kb[0]!) / 2))}" y="${f2(f.pz(lv + pH / 2))}" text-anchor="middle" font-size="2.1" fill="${INK_500}" style="font-family:${FONT_UI}">${esc(String(ps.soil ?? "planting"))}</text>`;
      body += rectU(f, kb[0]!, kb[1]!, lv, lv + pH, BONE, INK_900, 0.35);
      body += vDim(f, kb[1]!, lv + H, lv + pH, 10, "bench-back", sub(`el:${planter.id}:height_mm`, E("height_mm")));
      body += levelTag(f, umin, lv + pH, "TOC", add(base.src, `el:${planter.id}:height_mm`));
    }
    body += rectU(f, o0, o1, lv, lv + H, BONE, INK_900, 0.4);
    const clad = num(s.cladding_mm);
    if (clad) {
      body += rectU(f, o1 - clad / 1000, o1, lv, lv + H, "#D9D2C3", INK_900, 0.3);
      body += hDim(f, o1 - clad / 1000, o1, lv + H, -5, "counter-cladding", E("spec.cladding_mm"));
    }
    if (el.kind === "planter_run" && num(s.kerb_mm)) {
      const kb = Array.isArray(s.kerb_band_mm) ? (s.kerb_band_mm as number[]).map((v) => v / 1000) : [o1 - 0.1, o1];
      body += rectU(f, o0, kb[0]!, lv, lv + H - 0.05, "#E8E1CF", INK_500, 0.2);
      body += hDim(f, kb[0]!, kb[1]!, lv + H, -5, "planter-kerb", E("spec.kerb_mm"));
    }
    body += hDim(f, o0, o1, lv, 7, `${el.kind}-width`, E("width_mm"));
    body += vDim(f, o0, lv, lv + H, -8, `${el.kind}-section-height`, E("height_mm"));
    body += levelTag(f, umax, lv + H, code, add(base.src, E("height_mm")), { right: true });
    body += viewTitle(secBox, "Section — across the run", f.denom);
  }

  const title = `Sectional Elevation — ${name}`;
  return { kind: "structure_elevation", title, sheetNumber: number, subject: el.id, svg: sheet(meta, number, title, body, scales) };
}

// --- L-3nn: units (wall feature, planter box) -------------------------------------------------

function unitSheet(graph: PlanGraph, u: GardenFixture, meta: SheetMeta, number: string): ElevationSheet {
  const s = spec(u);
  const U = (f: string) => `unit:${u.id}:${f}`;
  const pos = toMetres(graph, u.position);
  const base = baseLevel(graph, pos);
  const lv = base.mm / 1000;
  const W = num(s.width_mm)! / 1000;
  const D = num(s.depth_mm)! / 1000;
  const H = num(s.height_mm)! / 1000;
  const name = u.type === "wall_feature" ? "Wall feature with bench" : "Planter box";
  const notes: { text: string; color?: string }[] = [{ text: `Source: ${String(s.source ?? "not sourced")}.` }];
  if (!base.stated) notes.push({ text: "The plan states no level for the ground here; heights are shown from an assumed ±000.", color: TERRACOTTA });
  const facts: [string, string][] = [["Width", String(mmOf(W))], ["Depth", String(mmOf(D))], ["Height", String(mmOf(H))]];
  const arch = (s.arch ?? {}) as Record<string, number>;
  const bench = (s.bench ?? {}) as Record<string, number>;
  if (u.type === "wall_feature") {
    facts.push(["Arch opening", String(arch.opening_mm)], ["Spring", fmtLevel(base.mm + arch.spring_mm)], ["Crown", fmtLevel(base.mm + arch.crown_mm)], ["Bench top", fmtLevel(base.mm + bench.top_mm)]);
  } else {
    facts.push(["Wall", String(num(s.wall_mm) ?? 200)]);
  }
  const panel = notesPanel(name, facts, notes);
  const topBox: Box = AREA;
  const botBox: Box = sideBox(panel.y);
  let body = panel.svg;
  const scales: number[] = [];

  if (u.type === "wall_feature") {
    const op = arch.opening_mm / 1000;
    const spring = arch.spring_mm / 1000;
    const crown = arch.crown_mm / 1000;
    const pier = (W - op) / 2;
    const f = efit(-0.05, W + 0.05, lv, lv + H, topBox);
    scales.push(f.denom);
    body += ground(f, -0.4, W + 0.4, lv);
    // Solid with an arched opening: path = outer rectangle minus the arch.
    const x0 = f.px(0), x1 = f.px(W), yb = f.pz(lv), yt = f.pz(lv + H);
    const ax0 = f.px(pier), ax1 = f.px(pier + op), ys = f.pz(lv + spring), yc = f.pz(lv + crown);
    const rx = (ax1 - ax0) / 2, ry = ys - yc;
    body += `<path d="M${f2(x0)},${f2(yb)} L${f2(x0)},${f2(yt)} L${f2(x1)},${f2(yt)} L${f2(x1)},${f2(yb)} L${f2(ax1)},${f2(yb)} L${f2(ax1)},${f2(ys)} A${f2(rx)},${f2(ry)} 0 0 0 ${f2(ax0)},${f2(ys)} L${f2(ax0)},${f2(yb)} Z" fill="${BONE}" stroke="${INK_900}" stroke-width="0.4"/>`;
    const bt = bench.top_mm / 1000;
    const bs = bench.slab_mm / 1000;
    body += rectU(f, pier, pier + op, lv + bt - bs, lv + bt, PAPER, INK_900, 0.35);
    body += hDim(f, 0, W, lv + H, -7, "wall-feature-width", U("spec.width_mm"));
    body += hDim(f, 0, pier, lv, 7, "wall-feature-pier", sub(`0.5*${U("spec.width_mm")}`, `0.5*${U("spec.arch.opening_mm")}`));
    body += hDim(f, pier, pier + op, lv, 7, "wall-feature-opening", U("spec.arch.opening_mm"));
    body += hDim(f, pier + op, W, lv, 7, "wall-feature-pier", sub(`0.5*${U("spec.width_mm")}`, `0.5*${U("spec.arch.opening_mm")}`));
    body += vDim(f, 0, lv, lv + H, -10, "wall-feature-height", U("spec.height_mm"));
    body += vDim(f, pier + op, lv, lv + spring, 6, "wall-feature-spring", U("spec.arch.spring_mm"));
    body += vDim(f, W / 2, lv + crown, lv + H, 4, "wall-feature-crown-cover", sub(U("spec.height_mm"), U("spec.arch.crown_mm")));
    body += vDim(f, W / 2, lv, lv + crown, -4, "wall-feature-crown", U("spec.arch.crown_mm"));
    body += vDim(f, pier + op * 0.25, lv, lv + bt, 4, "wall-feature-bench-top", U("spec.bench.top_mm"));
    body += levelTag(f, -0.4, lv, "FFL", base.src);
    body += levelTag(f, W + 0.4, lv + H, "TOC", add(base.src, U("spec.height_mm")), { right: true });
    body += levelTag(f, W + 0.4, lv + bt, "TOS", add(base.src, U("spec.bench.top_mm")), { right: true });
    body += viewTitle(topBox, "Sectional elevation A — front", f.denom);

    const proj = bench.projection_mm / 1000;
    const g = efit(-0.05, D + proj + 0.05, lv, lv + H, botBox);
    scales.push(g.denom);
    body += ground(g, -0.3, D + proj + 0.3, lv);
    body += rectU(g, 0, D, lv, lv + H, BONE, INK_900, 0.4);
    body += rectU(g, D, D + proj, lv + bt - bs, lv + bt, PAPER, INK_900, 0.35);
    body += hDim(g, 0, D, lv, 7, "wall-feature-depth", U("spec.depth_mm"));
    body += hDim(g, D, D + proj, lv, 7, "wall-feature-bench-projection", U("spec.bench.projection_mm"));
    body += vDim(g, D + proj, lv + bt - bs, lv + bt, 6, "wall-feature-bench-slab", U("spec.bench.slab_mm"));
    body += viewTitle(botBox, "Section B — through the bench", g.denom);
  } else {
    const wall = (num(s.wall_mm) ?? 200) / 1000;
    const f = efit(-0.05, W + 0.05, lv, lv + Math.max(H, 0.9), topBox);
    scales.push(f.denom);
    body += ground(f, -0.4, W + 0.4, lv);
    body += rectU(f, 0, W, lv, lv + H, BONE, INK_900, 0.4);
    body += rectU(f, wall, W - wall, lv + 0.05, lv + H, PAPER, INK_500, 0.2, ' stroke-dasharray="1 0.8"');
    body += hDim(f, 0, W, lv + H, -7, "planter-box-width", U("spec.width_mm"));
    body += hDim(f, 0, wall, lv, 7, "planter-box-wall", U("spec.wall_mm"));
    body += hDim(f, wall, W - wall, lv, 7, "planter-box-inner", sub(U("spec.width_mm"), `2*${U("spec.wall_mm")}`));
    body += hDim(f, W - wall, W, lv, 7, "planter-box-wall", U("spec.wall_mm"));
    body += vDim(f, 0, lv, lv + H, -10, "planter-box-height", U("spec.height_mm"));
    body += levelTag(f, -0.4, lv, "FFL", base.src);
    body += levelTag(f, W + 0.4, lv + H, "TOC", add(base.src, U("spec.height_mm")), { right: true });
    body += viewTitle(topBox, "Sectional elevation A", f.denom);
    const g = efit(-0.05, D + 0.05, lv, lv + Math.max(H, 0.9), botBox);
    scales.push(g.denom);
    body += ground(g, -0.3, D + 0.3, lv);
    body += rectU(g, 0, wall, lv, lv + H, BONE, INK_900, 0.4);
    body += rectU(g, D - wall, D, lv, lv + H, BONE, INK_900, 0.4);
    body += rectU(g, wall, D - wall, lv + 0.05, lv + H - 0.08, "#E8E1CF", INK_500, 0.2);
    body += hDim(g, 0, D, lv, 7, "planter-box-depth", U("spec.depth_mm"));
    body += viewTitle(botBox, "Section B", g.denom);
  }
  const title = `Sectional Elevation — ${name}`;
  return { kind: "structure_elevation", title, sheetNumber: number, subject: u.id, svg: sheet(meta, number, title, body, scales) };
}

// --- L-501: whole-garden elevation strips ---------------------------------------------------

interface Profile {
  label: string;
  u0: number;
  u1: number;
  base: number;
  top: number;
  /** Distance from the viewer: larger = further, drawn first. */
  depth: number;
  fill: string;
  derived: boolean;
  srcTop: string;
  kind: "wall" | "structure" | "context";
  /** Level code for the top: TRL, CTL, TOS, TOC, EBWL. */
  code: string;
  /** Open frame (a pergola): end posts and a top beam instead of a solid. */
  frame?: { member: number; beam: number };
}

function stripProfiles(graph: PlanGraph, fixtures: readonly GardenFixture[], axis: "x" | "y", region: { minX: number; maxX: number; minY: number; maxY: number }, viewerFar: (p: Point) => number): Profile[] {
  const out: Profile[] = [];
  const inRegion = (p: Point) => p[0] >= region.minX - 0.01 && p[0] <= region.maxX + 0.01 && p[1] >= region.minY - 0.01 && p[1] <= region.maxY + 0.01;
  const along = (p: Point) => (axis === "x" ? p[0] : region.maxY - p[1]);
  const span = (pts: Point[]) => {
    const us = pts.map(along);
    return [Math.min(...us), Math.max(...us)] as const;
  };
  const centre = (pts: Point[]): Point => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

  for (const c of graph.context) {
    // Only what stands in front of the viewer: a building behind the camera
    // (the villa, for a view looking away from it) is not in the elevation.
    if (!inRegion(centre(c.polygon)) || c.height_mm == null) continue;
    const [a, b] = span(c.polygon.map((p) => [Math.min(Math.max(p[0], region.minX), region.maxX), Math.min(Math.max(p[1], region.minY), region.maxY)] as Point));
    if (b - a < 0.02) continue;
    const kind = c.kind === "boundary_wall" ? "wall" : "context";
    out.push({
      label: c.name,
      u0: a,
      u1: b,
      base: c.base_mm / 1000,
      top: (c.base_mm + c.height_mm) / 1000,
      depth: viewerFar(centre(c.polygon)),
      fill: c.kind === "existing_building" ? "#E6E6E6" : c.kind === "boundary_wall" ? "#D9D2C3" : PAPER,
      derived: c.derived,
      srcTop: `ctx:${c.id}:height_mm`,
      kind,
      code: c.kind === "boundary_wall" ? "EBWL" : c.kind === "steps" ? "FFL" : "TOP",
      ...(c.kind === "existing_structure" ? { frame: { member: 0.1, beam: 0.15 } } : {}),
    });
  }
  for (const z of gardenZones(graph).filter((r) => r.type === "structure" && r.height_mm != null && r.polygon.some(inRegion))) {
    const [a, b] = span(z.polygon);
    const lv = (z.level_mm ?? 0) / 1000;
    const zs = spec(z);
    out.push({
      label: z.name_en,
      u0: a,
      u1: b,
      base: lv,
      top: lv + z.height_mm! / 1000,
      depth: viewerFar(centre(z.polygon)),
      fill: BONE,
      derived: false,
      srcTop: add(`room:${z.id}:level_mm`, `room:${z.id}:height_mm`),
      kind: "structure",
      code: "TRL",
      frame: { member: (num(zs.member_mm) ?? 150) / 1000, beam: (num(zs.beam_depth_mm) ?? 150) / 1000 },
    });
  }
  for (const el of graph.elements.filter((e) => e.kind !== "boundary_wall" && e.polyline.some(inRegion))) {
    const [o0, o1] = runBand(el);
    for (const seg of runSegments(el)) {
      const pts: Point[] = [
        [seg.a[0] + seg.normal[0] * o0, seg.a[1] + seg.normal[1] * o0],
        [seg.b[0] + seg.normal[0] * o0, seg.b[1] + seg.normal[1] * o0],
        [seg.b[0] + seg.normal[0] * o1, seg.b[1] + seg.normal[1] * o1],
        [seg.a[0] + seg.normal[0] * o1, seg.a[1] + seg.normal[1] * o1],
      ];
      const [a, b] = span(pts);
      const lv = baseLevel(graph, centre(pts));
      out.push({ label: LINEAR_ELEMENT_META[el.kind].label, u0: a, u1: b, base: lv.mm / 1000, top: (lv.mm + el.height_mm) / 1000, depth: viewerFar(centre(pts)), fill: BONE, derived: el.derived, srcTop: add(lv.src, `el:${el.id}:height_mm`), kind: "structure", code: el.kind === "counter_run" ? "CTL" : el.kind === "bench_run" ? "TOS" : "TOC" });
    }
  }
  for (const u of fixtures.filter((x) => x.layer === "landscape" && num(spec(x).height_mm) != null && num(spec(x).width_mm) != null)) {
    const p = toMetres(graph, u.position);
    if (!inRegion(p) || u.type === "bbq_grill") continue;
    const s = spec(u);
    const w = num(s.width_mm)! / 1000;
    const d = (num(s.depth_mm) ?? num(s.width_mm)!) / 1000;
    const halfU = (axis === "x" ? w : d) / 2;
    const lv = baseLevel(graph, p);
    out.push({ label: u.type === "wall_feature" ? "Wall feature" : "Planter box", u0: along(p) - halfU, u1: along(p) + halfU, base: lv.mm / 1000, top: (lv.mm + num(s.height_mm)!) / 1000, depth: viewerFar(p), fill: BONE, derived: false, srcTop: add(lv.src, `unit:${u.id}:spec.height_mm`), kind: "structure", code: "TOC" });
  }
  return out.sort((a, b) => b.depth - a.depth);
}

function gardenStripSheet(graph: PlanGraph, fixtures: readonly GardenFixture[], meta: SheetMeta, number: string): ElevationSheet | null {
  if (graph.context.length === 0 && !graph.rooms.some((r) => r.type === "structure")) return null;
  const plot = graph.meta.plot;
  const ox = plot ? plot.origin_m[0] : bboxOf(graph.rooms.flatMap((r) => r.polygon)).minX;
  const oy = plot ? plot.origin_m[1] : bboxOf(graph.rooms.flatMap((r) => r.polygon)).minY;
  const pw = plot ? plot.width_m : bboxOf(graph.rooms.flatMap((r) => r.polygon)).maxX - ox;
  // The backyard: from the north boundary to the villa's rear face when there is one.
  const building = graph.context.filter((c) => c.kind === "existing_building");
  const rear = building.length ? Math.min(...building.flatMap((c) => c.polygon.map((p) => p[1]))) : oy + 10;
  const backyard = { minX: ox, maxX: ox + pw, minY: oy, maxY: rear };
  const westStrip = { minX: ox, maxX: ox + pw * 0.45, minY: oy, maxY: Math.min(oy + 12, rear + 3) };

  const cap = 3.4;
  const strips: { title: string; profiles: Profile[]; u0: number; u1: number }[] = [
    { title: "North boundary — elevation looking north", profiles: stripProfiles(graph, fixtures, "x", backyard, (p) => -(p[1] - oy)), u0: ox, u1: ox + pw },
    { title: "West boundary — elevation looking west", profiles: stripProfiles(graph, fixtures, "y", westStrip, (p) => -(p[0] - ox)), u0: 0, u1: westStrip.maxY - westStrip.minY },
  ];
  let body = "";
  const scales: number[] = [];
  const notes: { text: string; color?: string }[] = [];
  strips.forEach((st, i) => {
    const box: Box = { x: AREA.x, y: AREA.y + (i * AREA.h) / 2, w: AREA.w, h: AREA.h / 2 };
    const f = efit(st.u0 - 0.1, st.u1 + 0.1, 0, cap, box);
    scales.push(f.denom);
    body += ground(f, st.u0 - 0.3, st.u1 + 0.3, 0);
    const clipId = `strip-${i}`;
    body += `<clipPath id="${clipId}"><rect x="${f2(f.px(st.u0 - 0.3))}" y="${f2(f.pz(cap))}" width="${f2((st.u1 - st.u0 + 0.6) * f.k)}" height="${f2((cap + 0.5) * f.k)}"/></clipPath><g clip-path="url(#${clipId})">`;
    for (const p of st.profiles) {
      const dash = p.kind === "context" ? ' stroke-dasharray="1.2 0.8"' : "";
      const stroke = p.kind === "context" ? INK_500 : INK_900;
      if (p.frame) {
        const t = Math.min(p.top, cap + 0.5);
        body += rectU(f, p.u0, p.u0 + p.frame.member, p.base, t, p.fill, stroke, 0.3, dash);
        body += rectU(f, p.u1 - p.frame.member, p.u1, p.base, t, p.fill, stroke, 0.3, dash);
        body += rectU(f, p.u0, p.u1, t - p.frame.beam, t, p.fill, stroke, 0.3, dash);
      } else {
        body += rectU(f, p.u0, p.u1, p.base, Math.min(p.top, cap + 0.5), p.fill, stroke, p.kind === "wall" ? 0.25 : 0.35, dash);
      }
    }
    body += `</g>`;
    // A break line where something runs above the strip.
    for (const p of st.profiles.filter((q) => q.top > cap)) {
      body += `<text x="${f2(f.px((p.u0 + p.u1) / 2))}" y="${f2(f.pz(cap) - 1.5)}" text-anchor="middle" font-size="2.1" fill="${INK_500}" style="font-family:${FONT_UI}">${esc(p.label)} continues to ${fmtLevel(p.top * 1000)}</text>`;
    }
    // Levels for the tallest few distinct tops, labelled once each.
    const seen = new Set<number>();
    let row = 0;
    let lastY = -Infinity;
    let stagger = 0;
    for (const p of [...st.profiles].sort((a, b) => b.top - a.top)) {
      const mm = mmOf(p.top);
      if (seen.has(mm) || p.top > cap || mm === 0) continue;
      seen.add(mm);
      const y = f.pz(p.top);
      stagger = Math.abs(y - lastY) < 3.2 ? stagger + 1 : 0;
      lastY = y;
      body += levelTag(f, st.u1 + 0.1 + (stagger * 22) / f.k, p.top, p.code, p.srcTop, { right: true, derived: p.derived });
      if (p.derived) notes.push({ text: `${p.label}: ${fmtLevel(mm)} is assumed or scaled, not dimensioned.`, color: TERRACOTTA });
      if (++row >= 6) break;
    }
    const wall = st.profiles.find((p) => p.kind === "wall" && p.u1 - p.u0 > (st.u1 - st.u0) * 0.5);
    if (wall) body += vDim(f, st.u0, 0, wall.top, -8, "boundary-wall-height", wall.srcTop, { derived: wall.derived });
    body += levelTag(f, st.u0 - 0.3, 0, "FFL", "k:0");
    body += hDim(f, st.u0, st.u1, 0, 8, "strip-length", i === 0 ? (plot ? "plot:width_mm" : "k:0") : `k:${mmOf(st.u1 - st.u0)}`);
    body += viewTitle(box, st.title, f.denom);
  });
  body += notesPanel("Garden elevations", [["Views", "2"], ["Datum", "±000 FFL"]], [
    { text: "Structures in profile at their plan positions, projected onto the boundary line. Existing buildings dashed and cut at the top of the strip." },
    ...notes.filter((n, i, a) => a.findIndex((m) => m.text === n.text) === i),
  ]).svg;
  const title = "Garden Elevations — Boundary Lines";
  return { kind: "garden_elevation", title, sheetNumber: number, subject: "garden", svg: sheet(meta, number, title, body, scales) };
}

// --- Assembly -----------------------------------------------------------------------------

export function buildElevationSheets(
  graph: PlanGraph,
  fixtures: readonly GardenFixture[],
  meta: SheetMeta,
  variants: Record<string, string | null> = {},
): ElevationSheet[] {
  const { structures, runs, units } = elevationSubjects(graph, fixtures, variants);
  const out: ElevationSheet[] = [];
  let n = 301;
  for (const z of structures) out.push(pergolaSheet(graph, z, meta, `L-${n++}`));
  for (const el of runs) out.push(runSheet(graph, el, meta, `L-${n++}`, variants[el.id] ?? null));
  for (const u of units) out.push(unitSheet(graph, u, meta, `L-${n++}`));
  const strip = gardenStripSheet(graph, fixtures, meta, "L-501");
  if (strip) out.push(strip);
  return out;
}

export type { ContextVolume };

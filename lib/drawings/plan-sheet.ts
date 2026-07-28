// =============================================================================
// lib/drawings/plan-sheet.ts — render a PlanGraph to an A3 sheet (Prompt P1).
//
// Deterministic, rule-based SVG. Walls draw as double lines at true thickness,
// openings as door swings / window lines (none today — empty), room labels
// (EN / AR / area in Mono, matching EditablePlanViewer), and dimension chains:
// overall envelope dims on all four sides + a per-bay chain on the two
// principal axes, offset 600 mm outside the envelope with ticks at extents.
// =============================================================================

import type { Opening, PlanGraph, Point, Wall } from "@/lib/plan/geometry";

import { dimensionChain, envelopeDimensionMm, graphBbox, roomBbox } from "./dimensions";
import {
  BONE,
  BRASS,
  drawRegion,
  esc,
  FONT_MONO,
  FONT_UI,
  INK_100,
  INK_500,
  INK_700,
  INK_900,
  MM_PER_M,
  renderSheet,
  type SheetMeta,
} from "./sheet";

const DIM_OFFSET_MM_REAL = 600; // dimension line sits 600 mm outside the envelope
const TICK = 1.4; // mm, dimension tick half-length on paper

/** metres → paper-mm transform, given a plan origin on the sheet. */
export interface Placement {
  ox: number; // paper x for plan x=0
  oy: number; // paper y for plan y=0
  px: (mx: number) => number;
  py: (my: number) => number;
}

export function computePlacement(graph: PlanGraph): Placement {
  return placement(graph);
}

function placement(graph: PlanGraph): Placement {
  const region = drawRegion();
  const b = graphBbox(graph);
  const planWmm = (b.maxX - b.minX) * MM_PER_M;
  const planHmm = (b.maxY - b.minY) * MM_PER_M;
  // Reserve room for the dimension chains (left + top).
  const pad = (DIM_OFFSET_MM_REAL / 1000) * MM_PER_M + 10; // 6 mm + text headroom
  // Upper-left placement inside the region, nudged right/down for the dim gutters.
  const availW = region.w - pad - 8;
  const availH = region.h - pad - 8;
  const ox = region.x + pad + Math.max(0, (availW - planWmm) / 2) - b.minX * MM_PER_M;
  const oy = region.y + pad + Math.max(0, (availH - planHmm) / 2) - b.minY * MM_PER_M;
  return {
    ox,
    oy,
    px: (mx: number) => ox + mx * MM_PER_M,
    py: (my: number) => oy + my * MM_PER_M,
  };
}

function polyPoints(poly: Point[], pl: Placement): string {
  return poly.map(([x, y]) => `${pl.px(x).toFixed(2)},${pl.py(y).toFixed(2)}`).join(" ");
}

/** A wall as two parallel faces at true thickness (double-line convention). */
export function wallSvg(w: Wall, pl: Placement, stroke = INK_900): string {
  const [a, b] = w.polyline;
  if (!a || !b) return "";
  const ax = pl.px(a[0]),
    ay = pl.py(a[1]),
    bx = pl.px(b[0]),
    by = pl.py(b[1]);
  const dx = bx - ax,
    dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len,
    ny = dx / len;
  const half = w.thickness_mm / 100 / 2; // real mm → paper mm (÷100 at 1:100), half each side
  const l1 = `${(ax + nx * half).toFixed(2)},${(ay + ny * half).toFixed(2)} ${(bx + nx * half).toFixed(2)},${(by + ny * half).toFixed(2)}`;
  const l2 = `${(ax - nx * half).toFixed(2)},${(ay - ny * half).toFixed(2)} ${(bx - nx * half).toFixed(2)},${(by - ny * half).toFixed(2)}`;
  return `<polyline points="${l1}" fill="none" stroke="${stroke}" stroke-width="0.35"/><polyline points="${l2}" fill="none" stroke="${stroke}" stroke-width="0.35"/>`;
}

/** Door swing (quarter arc) or window (double line across the reveal). */
function openingSvg(op: Opening, graph: PlanGraph, pl: Placement): string {
  const wall = graph.walls.find((w) => w.id === op.wall_id);
  if (!wall) return "";
  const [a, b] = wall.polyline;
  if (!a || !b) return "";
  const mx = (a[0] + b[0]) / 2,
    my = (a[1] + b[1]) / 2;
  const cx = pl.px(mx),
    cy = pl.py(my);
  const wPaper = op.width_mm / 100;
  if (op.type === "window") {
    return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="0.6" fill="${BRASS}"/>`;
  }
  // door: a small quarter-circle swing marker
  return `<path d="M ${cx} ${cy} l ${wPaper} 0 a ${wPaper} ${wPaper} 0 0 1 ${-wPaper} ${wPaper} Z" fill="none" stroke="${INK_500}" stroke-width="0.3"/>`;
}

function roomLabelSvg(graph: PlanGraph, pl: Placement): string {
  let out = "";
  for (const r of graph.rooms) {
    const bb = roomBbox(r);
    const cx = pl.px((bb.minX + bb.maxX) / 2);
    const cy = pl.py((bb.minY + bb.maxY) / 2);
    const wMm = Math.round((bb.maxX - bb.minX) * 1000);
    const dMm = Math.round((bb.maxY - bb.minY) * 1000);
    const hasAr = !!r.name_ar?.trim();
    const enY = hasAr ? cy - 3.4 : cy - 2.2;
    out += `<text x="${cx.toFixed(2)}" y="${enY.toFixed(2)}" text-anchor="middle" font-size="3.1" fill="${INK_900}" style="font-family:${FONT_UI};font-weight:500">${esc(r.name_en)}</text>`;
    if (hasAr) {
      out += `<text x="${cx.toFixed(2)}" y="${(cy - 0.2).toFixed(2)}" text-anchor="middle" font-size="2.8" fill="${INK_700}" style="font-family:${FONT_UI};direction:rtl">${esc(r.name_ar!)}</text>`;
    }
    out += `<text x="${cx.toFixed(2)}" y="${(cy + (hasAr ? 3.2 : 2)).toFixed(2)}" text-anchor="middle" font-size="2.7" fill="${INK_500}" style="font-family:${FONT_MONO}">${Math.round(r.area_m2)} m² · ${wMm}×${dMm}</text>`;
  }
  return out;
}

/** One dimension segment: line with end ticks + centred value in mm. */
function dimText(x: number, y: number, value: number, horizontal: boolean): string {
  const rot = horizontal ? "" : ` transform="rotate(-90 ${x} ${y})"`;
  return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="middle" font-size="2.6" fill="${INK_700}" style="font-family:${FONT_MONO}"${rot}>${value}</text>`;
}

function dimensionChainsSvg(graph: PlanGraph, pl: Placement): string {
  const b = graphBbox(graph);
  const offset = (DIM_OFFSET_MM_REAL / 1000) * MM_PER_M; // 6 mm
  let out = "";

  // --- Top: x-axis per-bay chain, one offset out ---
  const topY = pl.py(b.minY) - offset;
  const xChain = dimensionChain(graph, "x");
  out += `<line x1="${pl.px(b.minX).toFixed(2)}" y1="${topY.toFixed(2)}" x2="${pl.px(b.maxX).toFixed(2)}" y2="${topY.toFixed(2)}" stroke="${INK_500}" stroke-width="0.25"/>`;
  let cursor = b.minX;
  for (const seg of xChain) {
    const x0 = pl.px(cursor);
    const x1 = pl.px(cursor + seg.length_mm / 1000);
    out += `<line x1="${x0.toFixed(2)}" y1="${(topY - TICK).toFixed(2)}" x2="${x0.toFixed(2)}" y2="${(topY + TICK).toFixed(2)}" stroke="${INK_500}" stroke-width="0.25"/>`;
    out += dimText((x0 + x1) / 2, topY - 1.2, seg.length_mm, true);
    cursor += seg.length_mm / 1000;
  }
  out += `<line x1="${pl.px(b.maxX).toFixed(2)}" y1="${(topY - TICK).toFixed(2)}" x2="${pl.px(b.maxX).toFixed(2)}" y2="${(topY + TICK).toFixed(2)}" stroke="${INK_500}" stroke-width="0.25"/>`;

  // --- Left: y-axis per-bay chain ---
  const leftX = pl.px(b.minX) - offset;
  const yChain = dimensionChain(graph, "y");
  out += `<line x1="${leftX.toFixed(2)}" y1="${pl.py(b.minY).toFixed(2)}" x2="${leftX.toFixed(2)}" y2="${pl.py(b.maxY).toFixed(2)}" stroke="${INK_500}" stroke-width="0.25"/>`;
  let vcursor = b.minY;
  for (const seg of yChain) {
    const y0 = pl.py(vcursor);
    const y1 = pl.py(vcursor + seg.length_mm / 1000);
    out += `<line x1="${(leftX - TICK).toFixed(2)}" y1="${y0.toFixed(2)}" x2="${(leftX + TICK).toFixed(2)}" y2="${y0.toFixed(2)}" stroke="${INK_500}" stroke-width="0.25"/>`;
    out += dimText(leftX - 1.2, (y0 + y1) / 2, seg.length_mm, false);
    vcursor += seg.length_mm / 1000;
  }
  out += `<line x1="${(leftX - TICK).toFixed(2)}" y1="${pl.py(b.maxY).toFixed(2)}" x2="${(leftX + TICK).toFixed(2)}" y2="${pl.py(b.maxY).toFixed(2)}" stroke="${INK_500}" stroke-width="0.25"/>`;

  // --- Overall envelope dims on all four sides, one further offset out ---
  const envX = envelopeDimensionMm(graph, "x");
  const envY = envelopeDimensionMm(graph, "y");
  const o2 = offset + 6;
  const topY2 = pl.py(b.minY) - o2;
  const botY2 = pl.py(b.maxY) + o2;
  const leftX2 = pl.px(b.minX) - o2;
  const rightX2 = pl.px(b.maxX) + o2;
  const bracket = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${INK_900}" stroke-width="0.3"/>`;
  out += bracket(pl.px(b.minX), topY2, pl.px(b.maxX), topY2) + dimText((pl.px(b.minX) + pl.px(b.maxX)) / 2, topY2 - 1.4, envX, true);
  out += bracket(pl.px(b.minX), botY2, pl.px(b.maxX), botY2) + dimText((pl.px(b.minX) + pl.px(b.maxX)) / 2, botY2 + 3, envX, true);
  out += bracket(leftX2, pl.py(b.minY), leftX2, pl.py(b.maxY)) + dimText(leftX2 - 1.4, (pl.py(b.minY) + pl.py(b.maxY)) / 2, envY, false);
  out += bracket(rightX2, pl.py(b.minY), rightX2, pl.py(b.maxY)) + dimText(rightX2 + 4, (pl.py(b.minY) + pl.py(b.maxY)) / 2, envY, false);

  return out;
}

/** Drawing-content body for a plan (reused by demo-sheet with overrides). */
export function planBody(
  graph: PlanGraph,
  opts?: { wallStroke?: string; roomFill?: string; extra?: string; showDims?: boolean },
): string {
  const pl = placement(graph);
  const roomFill = opts?.roomFill ?? BONE;
  const wallStroke = opts?.wallStroke ?? INK_900;
  const showDims = opts?.showDims ?? true;

  const rooms = graph.rooms
    .map(
      (r) =>
        `<polygon points="${polyPoints(r.polygon, pl)}" fill="${roomFill}" fill-opacity="0.32" stroke="${INK_100}" stroke-width="0.15"/>`,
    )
    .join("");
  const walls = graph.walls.map((w) => wallSvg(w, pl, wallStroke)).join("");
  const openings = graph.openings.map((op) => openingSvg(op, graph, pl)).join("");
  const labels = roomLabelSvg(graph, pl);
  const dims = showDims ? dimensionChainsSvg(graph, pl) : "";
  return `<g>${rooms}${walls}${openings}${labels}${dims}${opts?.extra ?? ""}</g>`;
}

export function renderPlanSheet(
  graph: PlanGraph,
  meta: SheetMeta,
  sheet: { sheetNumber: string; title: string },
): string {
  return renderSheet({
    meta,
    sheetNumber: sheet.sheetNumber,
    title: sheet.title,
    body: planBody(graph),
    showNorthScale: true,
    northDeg: graph.meta.north_deg,
  });
}

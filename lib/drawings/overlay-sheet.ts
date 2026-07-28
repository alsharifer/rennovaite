// =============================================================================
// lib/drawings/overlay-sheet.ts — shared electrical/plumbing services sheet (P2).
//
// Reuses the P1 plan sheet (walls + room labels, dimensions off for clarity),
// overlays the layer's fixture symbols (short code in a small ring), and adds a
// symbol legend + a count table in the corners. Deterministic SVG; no LLM.
// =============================================================================

import { FIXTURE_META } from "@/lib/overlays/catalog";
import type { FixtureType, OverlayLayer } from "@/lib/overlays/types";
import type { PlanGraph } from "@/lib/plan/geometry";

import { computePlacement, planBody } from "./plan-sheet";
import {
  BONE,
  drawRegion,
  esc,
  FONT_MONO,
  FONT_UI,
  INK_100,
  INK_500,
  INK_900,
  PAPER,
  renderSheet,
  SHEET_MARGIN,
  type SheetMeta,
} from "./sheet";

export interface OverlayFixtureForSheet {
  type: FixtureType;
  position: [number, number]; // normalised plan space
}

/** normalised plan point → metres (inverse of buildPlanGraph mapping). */
function toMetres(graph: PlanGraph, p: [number, number]): [number, number] {
  const u = graph.meta.unit_to_m || 1;
  const [ox, oy] = graph.meta.norm_origin;
  return [(p[0] - ox) * u, (p[1] - oy) * u];
}

function symbol(px: number, py: number, code: string): string {
  return (
    `<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="2.2" fill="${PAPER}" stroke="${INK_900}" stroke-width="0.35"/>` +
    `<text x="${px.toFixed(2)}" y="${(py + 0.85).toFixed(2)}" text-anchor="middle" font-size="${code.length > 2 ? 1.9 : 2.3}" fill="${INK_900}" style="font-family:${FONT_UI};font-weight:600">${esc(code)}</text>`
  );
}

function legend(types: FixtureType[]): string {
  const x = SHEET_MARGIN + 4;
  const y = SHEET_MARGIN + 6;
  const rows = types
    .map((t, i) => {
      const m = FIXTURE_META[t];
      const ry = y + 4 + i * 4.6;
      return (
        `<circle cx="${x + 2}" cy="${(ry - 0.9).toFixed(2)}" r="2.1" fill="${PAPER}" stroke="${INK_900}" stroke-width="0.3"/>` +
        `<text x="${x + 2}" y="${(ry - 0.2).toFixed(2)}" text-anchor="middle" font-size="2.1" fill="${INK_900}" style="font-family:${FONT_UI};font-weight:600">${esc(m.code)}</text>` +
        `<text x="${x + 7}" y="${ry.toFixed(2)}" font-size="2.7" fill="${INK_500}" style="font-family:${FONT_UI}">${esc(m.label)}</text>`
      );
    })
    .join("");
  const h = 8 + types.length * 4.6;
  return `<rect x="${x - 3}" y="${y - 5}" width="52" height="${h}" fill="${PAPER}" stroke="${INK_100}" stroke-width="0.3"/><text x="${x - 1}" y="${y}" font-size="3" fill="${INK_900}" style="font-family:${FONT_UI};font-weight:600;letter-spacing:0.04em">LEGEND</text>${rows}`;
}

function countTable(counts: { type: FixtureType; n: number }[], title: string): string {
  const region = drawRegion();
  const w = 50;
  const x = region.x + region.w - w;
  const y = SHEET_MARGIN + 6;
  const rows = counts
    .map((c, i) => {
      const ry = y + 5 + i * 4;
      return (
        `<text x="${x + 1}" y="${ry.toFixed(2)}" font-size="2.6" fill="${INK_900}" style="font-family:${FONT_UI}">${esc(FIXTURE_META[c.type].label)}</text>` +
        `<text x="${x + w - 2}" y="${ry.toFixed(2)}" text-anchor="end" font-size="2.6" fill="${INK_900}" style="font-family:${FONT_MONO}">${c.n}</text>`
      );
    })
    .join("");
  const total = counts.reduce((s, c) => s + c.n, 0);
  const h = 9 + counts.length * 4;
  return (
    `<rect x="${x - 2}" y="${y - 5}" width="${w + 2}" height="${h}" fill="${PAPER}" stroke="${INK_100}" stroke-width="0.3"/>` +
    `<text x="${x + 1}" y="${y}" font-size="3" fill="${INK_900}" style="font-family:${FONT_UI};font-weight:600;letter-spacing:0.04em">${esc(title.toUpperCase())}</text>` +
    `<rect x="${x - 2}" y="${(y + 1.5).toFixed(2)}" width="${w + 2}" height="0.3" fill="${BONE}"/>` +
    rows +
    `<text x="${x + 1}" y="${(y + 6 + counts.length * 4).toFixed(2)}" font-size="2.6" fill="${INK_500}" style="font-family:${FONT_UI};font-weight:600">Total</text>` +
    `<text x="${x + w - 2}" y="${(y + 6 + counts.length * 4).toFixed(2)}" text-anchor="end" font-size="2.6" fill="${INK_900}" style="font-family:${FONT_MONO};font-weight:700">${total}</text>`
  );
}

export function renderServicesSheet(
  layer: OverlayLayer,
  graph: PlanGraph,
  fixtures: OverlayFixtureForSheet[],
  meta: SheetMeta,
  sheet: { sheetNumber: string; title: string },
  typeOrder: readonly FixtureType[],
): string {
  const pl = computePlacement(graph);
  const present = typeOrder.filter((t) => fixtures.some((f) => f.type === t));
  const counts = present.map((t) => ({ type: t, n: fixtures.filter((f) => f.type === t).length }));

  const symbols = fixtures
    .map((f) => {
      const m = toMetres(graph, f.position);
      return symbol(pl.px(m[0]), pl.py(m[1]), FIXTURE_META[f.type].code);
    })
    .join("");

  const body =
    planBody(graph, { roomFill: BONE, showDims: false }) +
    symbols +
    legend(present) +
    countTable(counts, layer === "electrical" ? "Electrical count" : "Plumbing count");

  return renderSheet({
    meta,
    sheetNumber: sheet.sheetNumber,
    title: sheet.title,
    body,
    showNorthScale: true,
    northDeg: graph.meta.north_deg,
  });
}

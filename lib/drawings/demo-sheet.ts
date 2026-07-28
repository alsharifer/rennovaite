// =============================================================================
// lib/drawings/demo-sheet.ts — proposed plan with demolition marking (P1).
//
// Diffs the as-built graph against the proposed graph (both from lib/plan):
//   - walls in as-built but NOT proposed  → demolition: dashed + cross-hatch,
//     `tertiary` terracotta.
//   - walls in proposed but NOT as-built  → new work: solid ink-900 + NEW tag.
// Deterministic; no LLM. When proposed === as-built (no locked design yet) the
// diff is empty and the legend says so.
// =============================================================================

import type { PlanGraph, Wall } from "@/lib/plan/geometry";

import { computePlacement, planBody, type Placement } from "./plan-sheet";
import {
  FONT_UI,
  INK_100,
  INK_900,
  PAPER,
  renderSheet,
  SHEET_MARGIN,
  TERRACOTTA,
  type SheetMeta,
} from "./sheet";

/** Order-independent geometric signature of a wall (0.1 m tolerance). */
function wallKey(w: Wall): string {
  const [a, b] = w.polyline;
  if (!a || !b) return "";
  const r = (v: number) => Math.round(v * 10) / 10;
  const p = [`${r(a[0])},${r(a[1])}`, `${r(b[0])},${r(b[1])}`].sort();
  return p.join("|");
}

function diffWalls(asBuilt: PlanGraph, proposed: PlanGraph): {
  demolished: Wall[];
  added: Wall[];
} {
  const builtKeys = new Map(asBuilt.walls.map((w) => [wallKey(w), w]));
  const propKeys = new Map(proposed.walls.map((w) => [wallKey(w), w]));
  const demolished = asBuilt.walls.filter((w) => !propKeys.has(wallKey(w)));
  const added = proposed.walls.filter((w) => !builtKeys.has(wallKey(w)));
  return { demolished, added };
}

function demolishedSvg(w: Wall, pl: Placement): string {
  const [a, b] = w.polyline;
  if (!a || !b) return "";
  const ax = pl.px(a[0]),
    ay = pl.py(a[1]),
    bx = pl.px(b[0]),
    by = pl.py(b[1]);
  const line = `<line x1="${ax.toFixed(2)}" y1="${ay.toFixed(2)}" x2="${bx.toFixed(2)}" y2="${by.toFixed(2)}" stroke="${TERRACOTTA}" stroke-width="0.7" stroke-dasharray="1.6 1.2"/>`;
  // cross-hatch ticks along the wall
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const ux = (bx - ax) / len,
    uy = (by - ay) / len;
  const nx = -uy,
    ny = ux;
  let hatch = "";
  for (let d = 1.5; d < len; d += 3) {
    const cx = ax + ux * d,
      cy = ay + uy * d;
    hatch += `<line x1="${(cx - nx - ux).toFixed(2)}" y1="${(cy - ny - uy).toFixed(2)}" x2="${(cx + nx + ux).toFixed(2)}" y2="${(cy + ny + uy).toFixed(2)}" stroke="${TERRACOTTA}" stroke-width="0.3"/>`;
  }
  return line + hatch;
}

function addedSvg(w: Wall, pl: Placement): string {
  const [a, b] = w.polyline;
  if (!a || !b) return "";
  const ax = pl.px(a[0]),
    ay = pl.py(a[1]),
    bx = pl.px(b[0]),
    by = pl.py(b[1]);
  const tagX = (ax + bx) / 2,
    tagY = (ay + by) / 2;
  return (
    `<line x1="${ax.toFixed(2)}" y1="${ay.toFixed(2)}" x2="${bx.toFixed(2)}" y2="${by.toFixed(2)}" stroke="${INK_900}" stroke-width="0.8"/>` +
    `<text x="${tagX.toFixed(2)}" y="${(tagY - 1).toFixed(2)}" text-anchor="middle" font-size="2.4" fill="${INK_900}" style="font-family:${FONT_UI};font-weight:600">NEW</text>`
  );
}

function legend(demolishedCount: number, addedCount: number): string {
  const x = SHEET_MARGIN + 4;
  const y = SHEET_MARGIN + 6;
  const none = demolishedCount === 0 && addedCount === 0;
  return `<g>
    <rect x="${x - 3}" y="${y - 5}" width="72" height="${none ? 16 : 22}" fill="${PAPER}" stroke="${INK_100}" stroke-width="0.3"/>
    <text x="${x}" y="${y}" font-size="3.2" fill="${INK_900}" style="font-family:${FONT_UI};font-weight:600;letter-spacing:0.04em">DEMOLITION PLAN</text>
    ${
      none
        ? `<text x="${x}" y="${y + 6}" font-size="2.7" fill="${INK_900}" style="font-family:${FONT_UI}">No changes — proposed matches as-built.</text>`
        : `<line x1="${x}" y1="${y + 5}" x2="${x + 8}" y2="${y + 5}" stroke="${TERRACOTTA}" stroke-width="0.7" stroke-dasharray="1.6 1.2"/>` +
          `<text x="${x + 10}" y="${y + 6}" font-size="2.7" fill="${INK_900}" style="font-family:${FONT_UI}">Demolish (${demolishedCount})</text>` +
          `<line x1="${x}" y1="${y + 10}" x2="${x + 8}" y2="${y + 10}" stroke="${INK_900}" stroke-width="0.8"/>` +
          `<text x="${x + 10}" y="${y + 11}" font-size="2.7" fill="${INK_900}" style="font-family:${FONT_UI}">New wall (${addedCount})</text>`
    }
  </g>`;
}

export function renderDemoSheet(
  asBuilt: PlanGraph,
  proposed: PlanGraph,
  meta: SheetMeta,
  sheet: { sheetNumber: string; title: string },
): string {
  const pl = computePlacement(proposed);
  const { demolished, added } = diffWalls(asBuilt, proposed);
  const overlay =
    demolished.map((w) => demolishedSvg(w, pl)).join("") +
    added.map((w) => addedSvg(w, pl)).join("") +
    legend(demolished.length, added.length);
  return renderSheet({
    meta,
    sheetNumber: sheet.sheetNumber,
    title: sheet.title,
    body: planBody(proposed, { extra: overlay }),
    showNorthScale: true,
    northDeg: proposed.meta.north_deg,
  });
}

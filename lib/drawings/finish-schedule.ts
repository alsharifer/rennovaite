// =============================================================================
// lib/drawings/finish-schedule.ts — finish-schedule table sheet (P1).
//
// Pure table renderer: one row per (room × surface). Columns Room / Surface /
// Material spec / Area m² / Notes. Areas come from the PlanGraph (Mono). The
// rows themselves are assembled in export.ts from the locked style + graph, so
// this module stays deterministic and data-source-agnostic.
// =============================================================================

import {
  BONE,
  drawRegion,
  esc,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_UI,
  INK_100,
  INK_500,
  INK_700,
  INK_900,
  renderSheet,
  type SheetMeta,
} from "./sheet";

export type Surface = "Floor" | "Wall" | "Ceiling";

export interface FinishRow {
  room: string;
  surface: Surface;
  material: string;
  area_m2: number;
  notes: string;
  /** First row of a room-group (renders the room name + a top divider). */
  groupStart?: boolean;
}

const COLS = [
  { key: "room", label: "Room", w: 46, align: "start" as const, font: FONT_UI },
  { key: "surface", label: "Surface", w: 26, align: "start" as const, font: FONT_UI },
  { key: "material", label: "Material spec", w: 150, align: "start" as const, font: FONT_UI },
  { key: "area", label: "Area m²", w: 28, align: "end" as const, font: FONT_MONO },
  { key: "notes", label: "Notes", w: 96, align: "start" as const, font: FONT_UI },
];

export function renderFinishSchedule(
  rows: FinishRow[],
  meta: SheetMeta,
  sheet: { sheetNumber: string; title: string },
): string {
  const region = drawRegion();
  const x0 = region.x + 4;
  const tableW = COLS.reduce((s, c) => s + c.w, 0);
  const headY = region.y + 14;
  const bodyTop = headY + 6;
  const availH = region.y + region.h - bodyTop - 8;
  const rowH = Math.max(3.6, Math.min(6, rows.length ? availH / rows.length : 6));

  // Column x offsets.
  const xs: number[] = [];
  let acc = x0;
  for (const c of COLS) {
    xs.push(acc);
    acc += c.w;
  }

  let head = `<text x="${x0}" y="${region.y + 8}" font-size="6.5" fill="${INK_900}" style="font-family:${FONT_DISPLAY}">Finish Schedule</text>`;
  head += `<line x1="${x0}" y1="${headY + 1.5}" x2="${x0 + tableW}" y2="${headY + 1.5}" stroke="${INK_900}" stroke-width="0.4"/>`;
  COLS.forEach((c, i) => {
    const tx = c.align === "end" ? xs[i]! + c.w - 2 : xs[i]! + 1;
    head += `<text x="${tx.toFixed(2)}" y="${headY}" text-anchor="${c.align}" font-size="3" fill="${INK_500}" style="font-family:${FONT_UI};font-weight:600;letter-spacing:0.05em">${c.label.toUpperCase()}</text>`;
  });

  let body = "";
  rows.forEach((r, ri) => {
    const y = bodyTop + ri * rowH + rowH - 1.4;
    if (r.groupStart && ri > 0) {
      body += `<line x1="${x0}" y1="${(bodyTop + ri * rowH).toFixed(2)}" x2="${x0 + tableW}" y2="${(bodyTop + ri * rowH).toFixed(2)}" stroke="${INK_100}" stroke-width="0.25"/>`;
    }
    const cells = [
      r.groupStart ? r.room : "",
      r.surface,
      r.material,
      Number.isFinite(r.area_m2) ? r.area_m2.toFixed(1) : "—",
      r.notes,
    ];
    COLS.forEach((c, i) => {
      const val = cells[i]!;
      if (!val) return;
      const tx = c.align === "end" ? xs[i]! + c.w - 2 : xs[i]! + 1;
      const fill = c.key === "room" ? INK_900 : c.key === "material" ? INK_700 : INK_700;
      const weight = c.key === "room" ? "600" : "400";
      const clipped = clip(val, c.w, c.font === FONT_MONO ? 1.9 : 1.7);
      body += `<text x="${tx.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="${c.align}" font-size="2.9" fill="${fill}" style="font-family:${c.font};font-weight:${weight}">${esc(clipped)}</text>`;
    });
  });

  // Row zebra for the area column band (subtle).
  const zebra = `<rect x="${xs[3]! - 0.5}" y="${bodyTop}" width="${COLS[3]!.w}" height="${(rows.length * rowH).toFixed(2)}" fill="${BONE}" fill-opacity="0.18"/>`;

  const body_g = `<g>${zebra}${head}${body}</g>`;
  return renderSheet({
    meta,
    sheetNumber: sheet.sheetNumber,
    title: sheet.title,
    body: body_g,
    showNorthScale: false,
  });
}

/** Rough character clip so long specs don't overrun their column. */
function clip(s: string, wMm: number, mmPerChar: number): string {
  const max = Math.max(4, Math.floor(wMm / mmPerChar));
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

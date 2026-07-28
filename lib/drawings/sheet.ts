// =============================================================================
// lib/drawings/sheet.ts — A3 landscape sheet template (Prompt P1, Atelier).
//
// Deterministic SVG. Units are MILLIMETRES: the sheet is authored at true A3
// size (420 × 297 mm) so it prints 1:1 on paper, and plan geometry is placed at
// 10 mm per metre (1:100). No LLM, no DOM.
//
// Typography follows the Atelier system: title-block/labels in Inter,
// dimensions & numerics in JetBrains Mono, headings in EB Garamond. Families
// are referenced via the app's CSS variables (resolved when the SVG is inlined
// in-page) with plain-name fallbacks (used by the server-side PDF rasteriser).
// =============================================================================

export const SHEET_W = 420; // mm (A3 landscape)
export const SHEET_H = 297;
export const SHEET_MARGIN = 12;
export const MM_PER_M = 10; // 1:100

// Title block, bottom-right.
export const TITLE_W = 132;
export const TITLE_H = 54;

// Atelier ink palette (hex, matches tailwind tokens).
export const INK_900 = "#0F1B2D";
export const INK_700 = "#334155";
export const INK_500 = "#64748b";
export const INK_100 = "#e2e8f0";
export const BONE = "#EDE6D8";
export const BRASS = "#A4793A";
export const TERRACOTTA = "#9d3e1d"; // `tertiary`
export const PAPER = "#FFFFFF";

export const FONT_UI = "var(--font-inter), 'Inter', system-ui, sans-serif";
export const FONT_MONO =
  "var(--font-jetbrains-mono), 'JetBrains Mono', ui-monospace, monospace";
export const FONT_DISPLAY =
  "var(--font-eb-garamond), 'EB Garamond', Georgia, serif";

export interface SheetMeta {
  projectNameEn: string;
  projectNameAr?: string | null;
  community: string; // plot / community line
  level: string;
  scale: string; // "1:100"
  dateISO: string; // YYYY-MM-DD
}

/** Region available for drawing content (inside margins, above the title block). */
export interface DrawRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function drawRegion(): DrawRegion {
  return {
    x: SHEET_MARGIN,
    y: SHEET_MARGIN,
    w: SHEET_W - 2 * SHEET_MARGIN,
    // Leave the bottom band clear of the title block corner + scale bar.
    h: SHEET_H - 2 * SHEET_MARGIN - 6,
  };
}

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(iso: string): string {
  // Keep it deterministic — no locale/timezone dependence.
  return iso;
}

function titleBlock(meta: SheetMeta, sheetNumber: string, sheetTitle: string): string {
  const x = SHEET_W - SHEET_MARGIN - TITLE_W;
  const y = SHEET_H - SHEET_MARGIN - TITLE_H;
  const rowH = TITLE_H / 3;
  const arName = meta.projectNameAr?.trim();
  return `
  <g>
    <rect x="${x}" y="${y}" width="${TITLE_W}" height="${TITLE_H}" fill="${PAPER}" stroke="${INK_900}" stroke-width="0.4"/>
    <line x1="${x}" y1="${y + rowH}" x2="${x + TITLE_W}" y2="${y + rowH}" stroke="${INK_100}" stroke-width="0.3"/>
    <line x1="${x}" y1="${y + 2 * rowH}" x2="${x + TITLE_W}" y2="${y + 2 * rowH}" stroke="${INK_100}" stroke-width="0.3"/>
    <text x="${x + 3}" y="${y + 7}" font-size="6.2" fill="${INK_900}" style="font-family:${FONT_DISPLAY}">${esc(meta.projectNameEn)}</text>
    ${arName ? `<text x="${x + TITLE_W - 3}" y="${y + 7}" text-anchor="end" font-size="5.5" fill="${INK_700}" style="font-family:${FONT_DISPLAY};direction:rtl">${esc(arName)}</text>` : ""}
    <text x="${x + 3}" y="${y + 12}" font-size="3.2" fill="${INK_500}" style="font-family:${FONT_UI}">${esc(meta.community)}</text>

    <text x="${x + 3}" y="${y + rowH + 7}" font-size="3.4" fill="${INK_900}" style="font-family:${FONT_UI};letter-spacing:0.04em">${esc(sheetTitle.toUpperCase())}</text>
    <text x="${x + 3}" y="${y + rowH + 13}" font-size="3" fill="${INK_500}" style="font-family:${FONT_UI}">Level: ${esc(meta.level)}</text>

    <text x="${x + 3}" y="${y + 2 * rowH + 6.5}" font-size="3" fill="${INK_500}" style="font-family:${FONT_UI}">SCALE</text>
    <text x="${x + 3}" y="${y + 2 * rowH + 12}" font-size="4.2" fill="${INK_900}" style="font-family:${FONT_MONO}">${esc(meta.scale)}</text>
    <text x="${x + 42}" y="${y + 2 * rowH + 6.5}" font-size="3" fill="${INK_500}" style="font-family:${FONT_UI}">DATE</text>
    <text x="${x + 42}" y="${y + 2 * rowH + 12}" font-size="4.2" fill="${INK_900}" style="font-family:${FONT_MONO}">${esc(fmtDate(meta.dateISO))}</text>
    <text x="${x + TITLE_W - 3}" y="${y + 2 * rowH + 6.5}" text-anchor="end" font-size="3" fill="${INK_500}" style="font-family:${FONT_UI}">SHEET</text>
    <text x="${x + TITLE_W - 3}" y="${y + 2 * rowH + 12}" text-anchor="end" font-size="4.6" fill="${BRASS}" style="font-family:${FONT_MONO}">${esc(sheetNumber)}</text>

    <text x="${x + TITLE_W - 3}" y="${y + 12}" text-anchor="end" font-size="4.4" fill="${BRASS}" style="font-family:${FONT_DISPLAY};letter-spacing:0.02em">RennovAIte</text>
  </g>`;
}

function northArrow(cx: number, cy: number, northDeg: number): string {
  // Arrow points "up" then rotates by north_deg (0 = up).
  return `
  <g transform="translate(${cx} ${cy}) rotate(${northDeg})">
    <polygon points="0,-9 3.2,4 0,1.4 -3.2,4" fill="${INK_900}"/>
    <text x="0" y="-11" text-anchor="middle" font-size="4" fill="${INK_900}" style="font-family:${FONT_UI};font-weight:600">N</text>
  </g>`;
}

function scaleBar(x: number, y: number): string {
  // 0–5 m bar at 1:100 → 50 mm, alternating filled/empty 1 m (10 mm) cells.
  const cell = MM_PER_M; // 10 mm = 1 m
  const cells = 5;
  let bars = "";
  for (let i = 0; i < cells; i++) {
    bars += `<rect x="${x + i * cell}" y="${y}" width="${cell}" height="1.6" fill="${i % 2 === 0 ? INK_900 : PAPER}" stroke="${INK_900}" stroke-width="0.3"/>`;
  }
  let ticks = "";
  for (let i = 0; i <= cells; i++) {
    ticks += `<text x="${x + i * cell}" y="${y + 5.5}" text-anchor="middle" font-size="3" fill="${INK_700}" style="font-family:${FONT_MONO}">${i}</text>`;
  }
  return `<g>${bars}${ticks}<text x="${x + cells * cell + 3}" y="${y + 2}" font-size="3" fill="${INK_500}" style="font-family:${FONT_UI}">m</text></g>`;
}

export interface RenderSheetOptions {
  meta: SheetMeta;
  sheetNumber: string;
  title: string;
  /** Inner SVG for the drawing content (already positioned in mm). */
  body: string;
  /** Show north arrow + scale bar (plans yes, schedule no). */
  showNorthScale?: boolean;
  northDeg?: number;
}

/** Compose a full A3 sheet: frame + body + north/scale + title block. */
export function renderSheet(o: RenderSheetOptions): string {
  const showNS = o.showNorthScale ?? true;
  const ns = showNS
    ? northArrow(SHEET_W - SHEET_MARGIN - TITLE_W - 14, SHEET_H - SHEET_MARGIN - 16, o.northDeg ?? 0) +
      scaleBar(SHEET_MARGIN + 2, SHEET_H - SHEET_MARGIN - 5)
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_W}mm" height="${SHEET_H}mm" viewBox="0 0 ${SHEET_W} ${SHEET_H}" role="img" aria-label="${esc(o.title)}">
  <rect x="0" y="0" width="${SHEET_W}" height="${SHEET_H}" fill="${PAPER}"/>
  <rect x="${SHEET_MARGIN / 2}" y="${SHEET_MARGIN / 2}" width="${SHEET_W - SHEET_MARGIN}" height="${SHEET_H - SHEET_MARGIN}" fill="none" stroke="${INK_900}" stroke-width="0.5"/>
  ${o.body}
  ${ns}
  ${titleBlock(o.meta, o.sheetNumber, o.title)}
</svg>`;
}

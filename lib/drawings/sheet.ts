// =============================================================================
// lib/drawings/sheet.ts — A3 landscape sheet template (Prompt P1; the frame,
// title block, status strip, north arrow and scale bar are K8 #17 Blueprint
// paper, Figma 68:1542, spec §6.9).
//
// Deterministic SVG. Units are MILLIMETRES: the sheet is authored at true A3
// size (420 × 297 mm) so it prints 1:1 on paper, and plan geometry is placed at
// 10 mm per metre (1:100). No LLM, no DOM.
//
// Typography: labels in IBM Plex Sans, dimensions & numerics in JetBrains Mono,
// display in EB Garamond. Families are referenced via the app's CSS variables
// (resolved when the SVG is inlined in-page) with plain-name fallbacks (used by
// the server-side PDF rasteriser, which reads TTF/OTF only — Arial / Consolas /
// Georgia there). Drawings are always light (spec §6.11).
// =============================================================================

import type { LinearElementKind } from "@/lib/plan/elements";

export const SHEET_W = 420; // mm (A3 landscape)
export const SHEET_H = 297;
export const SHEET_MARGIN = 12;
export const MM_PER_M = 10; // 1:100

// Title block, bottom-right.
export const TITLE_W = 132;
export const TITLE_H = 54;

// Blueprint light ink (design-refs/r7-handoff/tokens.css primitives).
export const INK_900 = "#1A1D1F";
export const INK_700 = "#4A5054";
export const INK_500 = "#62676B";
export const INK_100 = "#D6D1C5";
/** Inverse text on ink (the status strip, the draft stamp). */
export const ON_INK = "#F5F2EA";
/**
 * K9 (K8 review ruling 5): drawings are INK ONLY. No brass, no terracotta, no
 * hue inside a sheet — demolition is dashed, an estimated item is hatched and
 * carries the derived ring (○), symbols are ink, fills are paper tints.
 * lib/drawings/__tests__/ink-only.test.ts holds every sheet module to it.
 */
export const BONE = "#ECE8DE"; // paper-200 — a fill tint (the name predates K9)
export const PAPER_100 = "#F5F2EA";
export const PAPER = "#FFFFFF";
/** The derived mark as text — the open ring of the provenance glyph. */
export const DERIVED_GLYPH = "○";

/** The derived ring beside an estimated item (the provenance glyph's ring, in ink). */
export function derivedRing(cx: number, cy: number, r = 0.9): string {
  return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r}" fill="${PAPER}" stroke="${INK_900}" stroke-width="0.3" data-derived-mark="true"/>`;
}

/**
 * A run's ink on a sheet. `LINEAR_ELEMENT_META.color` is the EDITOR's hue and
 * never reaches a drawing: on paper a run is told apart by its tone and its
 * code (CT / BN / PL …), which every run label carries.
 */
export const RUN_INK: Record<LinearElementKind, string> = {
  boundary_wall: INK_900,
  counter_run: INK_900,
  bench_run: INK_700,
  planter_run: INK_500,
  stepping_path: INK_500,
  string_light_run: INK_700,
};

/** The hatch an estimated area is drawn with: sparse ink diagonals. Put `HATCH_DEFS` in the sheet's <defs>. */
export const HATCH_DEFS = `<pattern id="pat-derived" width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="2.4" stroke="${INK_500}" stroke-width="0.14"/></pattern>`;

export const FONT_UI = "var(--font-plex-sans), 'IBM Plex Sans', Arial, Helvetica, sans-serif";
export const FONT_MONO =
  "var(--font-jetbrains-mono), 'JetBrains Mono', Consolas, 'Courier New', monospace";
export const FONT_DISPLAY =
  "var(--font-eb-garamond), 'EB Garamond', Georgia, serif";

export interface SheetMeta {
  projectNameEn: string;
  projectNameAr?: string | null;
  community: string; // plot / community line
  level: string;
  scale: string; // "1:100"
  dateISO: string; // YYYY-MM-DD
  /**
   * G4b: stamps the sheet with the project it belongs to (data-project-id on
   * the root). Absent on interior sheets, which therefore render unchanged.
   */
  projectId?: string;
  /**
   * G5: the draft statement. Present → every sheet carries it in a stamp above
   * the title block and data-draft="true" on its root. Absent on every sheet
   * built before G5, which therefore renders unchanged.
   */
  draft?: string | null;
  /** K8: who prepared the set — the project's firm (its own project only), else omitted. */
  preparedBy?: string | null;
  /**
   * K9: the BoQ revision the set was generated from (`sheetRev`) — the rail's
   * rev N = the N-th BoQ, so a sheet and the bill beside it carry the same REV.
   */
  rev: string;
  /**
   * C2: what the sheet was drawn from, printed after the level in the title
   * block ("Proposed as of rev 3 · 21 Oct 2026"). Absent on every other sheet.
   */
  basis?: string | null;
}

/** "Proposed as of rev N · 21 Oct 2026" — the A-102 basis (C2): the current plan at export. */
export function proposedBasis(rev: string, dateISO: string): string {
  return `Proposed as of rev ${rev} · ${fmtDate(dateISO)}`;
}

/**
 * K9 (K8 review): a sheet's REV is the BoQ revision it was generated from —
 * never "—". rev N = the project's N-th BoQ (oldest = rev 1, the revisions
 * view's numbering); a set drawn before the first BoQ is rev 0.
 */
export function sheetRev(boqRevisions: number): string {
  return String(Math.max(0, Math.floor(boqRevisions)));
}

/** The status every sheet carries until a construction issue exists (68:1542). */
export const SHEET_STATUS = "FOR REVIEW — NOT FOR CONSTRUCTION";

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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "4 Oct 2026" — deterministic, no locale or timezone. */
function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso;
}

const tl = (x: number, y: number, s: string) => `<text x="${x}" y="${y}" font-size="2.3" fill="${INK_500}" style="font-family:${FONT_MONO};letter-spacing:0.08em">${esc(s.toUpperCase())}</text>`;
const tv = (x: number, y: number, s: string, size = 3.4, font = FONT_UI) => `<text x="${x}" y="${y}" font-size="${size}" fill="${INK_900}" style="font-family:${font}">${esc(s)}</text>`;

/**
 * The title block (68:1542): client / project · sheet title · sheet, scale,
 * rev, date · prepared by, drawn with · the inverse status strip. The same
 * 132 × 54 mm the sheets lay out around (TITLE_W / TITLE_H). No supplier or
 * contractor name — "prepared by" is the project's own firm or nobody.
 */
function titleBlock(meta: SheetMeta, sheetNumber: string, sheetTitle: string): string {
  const x = SHEET_W - SHEET_MARGIN - TITLE_W;
  const y = SHEET_H - SHEET_MARGIN - TITLE_H;
  const r = [0, 13.5, 27, 38.5, 48, TITLE_H].map((d) => y + d); // row edges
  const arName = meta.projectNameAr?.trim();
  const cols = [x, x + 26, x + 62, x + 78];
  const hl = (yy: number) => `<line x1="${x}" y1="${yy}" x2="${x + TITLE_W}" y2="${yy}" stroke="${INK_900}" stroke-width="0.25"/>`;
  const vl = (xx: number, y1: number, y2: number) => `<line x1="${xx}" y1="${y1}" x2="${xx}" y2="${y2}" stroke="${INK_900}" stroke-width="0.25"/>`;
  return `
  <g data-title-block="true">
    <rect x="${x}" y="${y}" width="${TITLE_W}" height="${TITLE_H}" fill="${PAPER}" stroke="${INK_900}" stroke-width="0.4"/>
    ${hl(r[1]!)}${hl(r[2]!)}${hl(r[3]!)}${hl(r[4]!)}
    ${vl(cols[1]!, r[2]!, r[3]!)}${vl(cols[2]!, r[2]!, r[3]!)}${vl(cols[3]!, r[2]!, r[3]!)}${vl(x + TITLE_W / 2, r[3]!, r[4]!)}
    ${tl(x + 2.5, r[0]! + 3.6, "Client / project")}
    ${tv(x + 2.5, r[0]! + 8.4, meta.projectNameEn, 3.8)}
    ${arName ? `<text x="${x + TITLE_W - 2.5}" y="${r[0]! + 8.4}" text-anchor="end" font-size="3.6" fill="${INK_700}" style="font-family:${FONT_DISPLAY};direction:rtl">${esc(arName)}</text>` : ""}
    ${tv(x + 2.5, r[0]! + 12.2, meta.community, 2.8)}
    ${tl(x + 2.5, r[1]! + 3.6, "Sheet title")}
    ${tv(x + 2.5, r[1]! + 8.4, sheetTitle, 3.8)}
    ${meta.basis ? `<g data-basis="${esc(meta.basis)}">${tv(x + 2.5, r[1]! + 12.2, `Level: ${meta.level} · ${meta.basis}`, 2.8)}</g>` : tv(x + 2.5, r[1]! + 12.2, `Level: ${meta.level}`, 2.8)}
    ${tl(cols[0]! + 2.5, r[2]! + 3.6, "Sheet")}
    <text x="${cols[0]! + 2.5}" y="${r[2]! + 9}" font-size="4.6" fill="${INK_900}" style="font-family:${FONT_MONO};font-weight:600">${esc(sheetNumber)}</text>
    ${tl(cols[1]! + 2.5, r[2]! + 3.6, "Scale")}
    ${tv(cols[1]! + 2.5, r[2]! + 9, `${meta.scale} @ A3`, 3.2, FONT_MONO)}
    ${tl(cols[2]! + 2.5, r[2]! + 3.6, "Rev")}
    ${tv(cols[2]! + 2.5, r[2]! + 9, meta.rev, 3.2, FONT_MONO)}
    ${tl(cols[3]! + 2.5, r[2]! + 3.6, "Date")}
    ${tv(cols[3]! + 2.5, r[2]! + 9, fmtDate(meta.dateISO), 3.2, FONT_MONO)}
    ${tl(x + 2.5, r[3]! + 3.4, "Prepared by")}
    ${tv(x + 2.5, r[3]! + 7.9, meta.preparedBy?.trim() || "—", 3)}
    ${tl(x + TITLE_W / 2 + 2.5, r[3]! + 3.4, "Drawn with")}
    ${tv(x + TITLE_W / 2 + 2.5, r[3]! + 7.9, "RenovAIte · from your plan", 3)}
    <rect x="${x}" y="${r[4]}" width="${TITLE_W}" height="${TITLE_H - 48}" fill="${INK_900}" data-sheet-status="true"/>
    <text x="${x + 2.5}" y="${r[4]! + 4.1}" font-size="2.6" fill="${ON_INK}" style="font-family:${FONT_MONO};letter-spacing:0.08em">${esc(SHEET_STATUS)}</text>
  </g>`;
}

/** G5: the draft stamp — the inverse block, directly above the title block, on every sheet. */
export const DRAFT_STAMP_BOX = { h: 13, gap: 2 };
function draftStamp(statement: string): string {
  const x = SHEET_W - SHEET_MARGIN - TITLE_W;
  const y = SHEET_H - SHEET_MARGIN - TITLE_H - DRAFT_STAMP_BOX.gap - DRAFT_STAMP_BOX.h;
  const [head, ...rest] = statement.split(" — ");
  return `
  <g data-draft-stamp="true" data-draft-statement="${esc(statement)}">
    <rect x="${x}" y="${y}" width="${TITLE_W}" height="${DRAFT_STAMP_BOX.h}" fill="${INK_900}"/>
    <text x="${x + 3}" y="${y + 5.4}" font-size="3.6" fill="${ON_INK}" style="font-family:${FONT_MONO};font-weight:600;letter-spacing:0.08em">${esc(head ?? statement)}</text>
    <text x="${x + 3}" y="${y + 10.2}" font-size="2.6" fill="${ON_INK}" style="font-family:${FONT_UI}">${esc(rest.join(" — "))}</text>
  </g>`;
}

function northArrow(cx: number, cy: number, northDeg: number): string {
  // Arrow points "up" then rotates by north_deg (0 = up).
  return `
  <g transform="translate(${cx} ${cy}) rotate(${northDeg})">
    <polygon points="0,-9 3.2,4 0,1.4 -3.2,4" fill="${INK_900}"/>
    <text x="0" y="-11" text-anchor="middle" font-size="3.6" fill="${INK_900}" style="font-family:${FONT_MONO};font-weight:600">N</text>
  </g>`;
}

function scaleBar(x: number, y: number, mmPerM: number = MM_PER_M, cells = 5, stepM = 1): string {
  // Default: 0–5 m bar at 1:100 → 50 mm, alternating filled/empty 1 m (10 mm)
  // cells. G4 garden sheets pass their own scale so the bar stays true.
  const cell = mmPerM * stepM;
  let bars = "";
  for (let i = 0; i < cells; i++) {
    bars += `<rect x="${x + i * cell}" y="${y}" width="${cell}" height="1.6" fill="${i % 2 === 0 ? INK_900 : PAPER}" stroke="${INK_900}" stroke-width="0.3"/>`;
  }
  let ticks = "";
  for (let i = 0; i <= cells; i++) {
    ticks += `<text x="${x + i * cell}" y="${y + 5.5}" text-anchor="middle" font-size="3" fill="${INK_700}" style="font-family:${FONT_MONO}">${i * stepM}</text>`;
  }
  return `<g>${bars}${ticks}<text x="${x + cells * cell + 3}" y="${y + 2}" font-size="3" fill="${INK_500}" style="font-family:${FONT_MONO}">m</text></g>`;
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
  /**
   * G4: a non-1:100 sheet's scale bar. Absent → the original 1:100 bar, so
   * every existing sheet renders byte-identically.
   */
  scaleBar?: { mmPerM: number; cells: number; stepM: number };
}

/** Compose a full A3 sheet: frame + body + north/scale + title block. */
export function renderSheet(o: RenderSheetOptions): string {
  const showNS = o.showNorthScale ?? true;
  const ns = showNS
    ? northArrow(SHEET_W - SHEET_MARGIN - TITLE_W - 14, SHEET_H - SHEET_MARGIN - 16, o.northDeg ?? 0) +
      (o.scaleBar
        ? scaleBar(SHEET_MARGIN + 2, SHEET_H - SHEET_MARGIN - 5, o.scaleBar.mmPerM, o.scaleBar.cells, o.scaleBar.stepM)
        : scaleBar(SHEET_MARGIN + 2, SHEET_H - SHEET_MARGIN - 5))
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_W}mm" height="${SHEET_H}mm" viewBox="0 0 ${SHEET_W} ${SHEET_H}" role="img" aria-label="${esc(o.title)}"${o.meta.projectId ? ` data-project-id="${esc(o.meta.projectId)}"` : ""}${o.meta.draft ? ` data-draft="true"` : ""}>
  <rect x="0" y="0" width="${SHEET_W}" height="${SHEET_H}" fill="${PAPER}"/>
  <rect x="${SHEET_MARGIN / 2}" y="${SHEET_MARGIN / 2}" width="${SHEET_W - SHEET_MARGIN}" height="${SHEET_H - SHEET_MARGIN}" fill="none" stroke="${INK_900}" stroke-width="0.5"/>
  ${o.body}
  ${ns}
  ${titleBlock(o.meta, o.sheetNumber, o.title)}${o.meta.draft ? `\n  ${draftStamp(o.meta.draft)}` : ""}
</svg>`;
}

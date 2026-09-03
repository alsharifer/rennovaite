// =============================================================================
// lib/drawings/opening-schedule.ts — door/window schedule sheet (A5).
//
// The standard schedule an estimator expects: one row per opening, grouped by
// kind (doors, then windows, then archways), each group numbered with its own
// mark series (D-01…, W-01…, A-01…) and closed with a count + area subtotal.
//
// Pure table renderer, same contract as finish-schedule.ts: rows are assembled
// in export.ts from the PlanGraph at document-assembly time, so this module
// stays deterministic and data-source-agnostic.
//
// The DERIVED column is the point of the sheet as much as the dimensions are:
// a defaulted 0.9×2.1 door and a measured one must never look alike to whoever
// is pricing the joinery.
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

export type OpeningKind = "door" | "window" | "archway";

export interface OpeningRow {
  /** Schedule mark, e.g. "D-01". Assigned per kind group. */
  mark: string;
  kind: OpeningKind;
  room: string;
  /** Derived wall id the opening snapped to ("—" when unsnapped). */
  wall: string;
  width_mm: number;
  height_mm: number;
  sill_mm: number;
  /** "Parsed" | "User drawn". */
  source: string;
  /** true = dimensions defaulted, not measured. */
  derived: boolean;
  /** First row of a kind-group (renders the group heading + a top divider). */
  groupStart?: boolean;
  /** Group heading text, set on the group's first row. */
  groupLabel?: string;
}

const COLS = [
  { key: "mark", label: "Mark", w: 20, align: "start" as const, font: FONT_MONO },
  { key: "room", label: "Room", w: 62, align: "start" as const, font: FONT_UI },
  { key: "wall", label: "Wall ref", w: 26, align: "start" as const, font: FONT_MONO },
  { key: "size", label: "W × H (mm)", w: 40, align: "end" as const, font: FONT_MONO },
  { key: "sill", label: "Sill (mm)", w: 26, align: "end" as const, font: FONT_MONO },
  { key: "area", label: "Area m²", w: 26, align: "end" as const, font: FONT_MONO },
  { key: "source", label: "Source", w: 30, align: "start" as const, font: FONT_UI },
  { key: "derived", label: "Dims", w: 36, align: "start" as const, font: FONT_UI },
];

const KIND_LABEL: Record<OpeningKind, string> = {
  door: "Doors",
  window: "Windows",
  archway: "Archways",
};

const MARK_PREFIX: Record<OpeningKind, string> = {
  door: "D",
  window: "W",
  archway: "A",
};

/** Opening leaf area in m² (the quantity deducted from wall finishes). */
export function openingAreaM2(o: { width_mm: number; height_mm: number }): number {
  return Math.round(((o.width_mm / 1000) * (o.height_mm / 1000)) * 100) / 100;
}

export interface ScheduleSourceOpening {
  id: string;
  type: OpeningKind;
  room_id: string | null;
  wall_id: string | null;
  width_mm: number;
  height_mm: number;
  sill_mm: number;
  source: "parsed" | "user_drawn";
  derived: boolean;
}

/**
 * Assemble schedule rows from graph openings, grouped by kind and marked per
 * group. Deterministic ordering: kind (door → window → archway), then room
 * name, then wall id — so re-running the document set produces the same marks.
 */
export function buildOpeningRows(
  openings: ScheduleSourceOpening[],
  roomNameById: Map<string, string>,
): OpeningRow[] {
  const order: OpeningKind[] = ["door", "window", "archway"];
  const rows: OpeningRow[] = [];

  for (const kind of order) {
    const group = openings
      .filter((o) => o.type === kind)
      .map((o) => ({
        o,
        room: (o.room_id && roomNameById.get(o.room_id)) || "Unassigned",
        wall: o.wall_id ?? "—",
      }))
      .sort(
        (a, b) =>
          a.room.localeCompare(b.room) ||
          a.wall.localeCompare(b.wall, undefined, { numeric: true }),
      );

    group.forEach(({ o, room, wall }, i) => {
      rows.push({
        mark: `${MARK_PREFIX[kind]}-${String(i + 1).padStart(2, "0")}`,
        kind,
        room,
        wall,
        width_mm: o.width_mm,
        height_mm: o.height_mm,
        sill_mm: o.sill_mm,
        source: o.source === "parsed" ? "Parsed" : "User drawn",
        derived: o.derived,
        ...(i === 0
          ? { groupStart: true, groupLabel: `${KIND_LABEL[kind]} (${group.length})` }
          : {}),
      });
    });
  }

  return rows;
}

export function renderOpeningSchedule(
  rows: OpeningRow[],
  meta: SheetMeta,
  sheet: { sheetNumber: string; title: string },
): string {
  const region = drawRegion();
  const x0 = region.x + 4;
  const tableW = COLS.reduce((s, c) => s + c.w, 0);
  const headY = region.y + 18;
  const bodyTop = headY + 4;
  const availH = region.y + region.h - bodyTop - 12;
  // Group headings consume a row's worth of space each.
  const groupCount = rows.filter((r) => r.groupStart).length;
  const slots = rows.length + groupCount;
  const rowH = Math.max(3.6, Math.min(6, slots ? availH / slots : 6));

  const xs: number[] = [];
  let acc = x0;
  for (const c of COLS) {
    xs.push(acc);
    acc += c.w;
  }

  let head = `<text x="${x0}" y="${region.y + 8}" font-size="6.5" fill="${INK_900}" style="font-family:${FONT_DISPLAY}">Door &amp; Window Schedule</text>`;
  head += `<line x1="${x0}" y1="${headY + 1.5}" x2="${x0 + tableW}" y2="${headY + 1.5}" stroke="${INK_900}" stroke-width="0.4"/>`;
  COLS.forEach((c, i) => {
    const tx = c.align === "end" ? xs[i]! + c.w - 2 : xs[i]! + 1;
    head += `<text x="${tx.toFixed(2)}" y="${headY}" text-anchor="${c.align}" font-size="3" fill="${INK_500}" style="font-family:${FONT_UI};font-weight:600;letter-spacing:0.05em">${c.label.toUpperCase()}</text>`;
  });

  let body = "";
  let slot = 0;
  for (const r of rows) {
    if (r.groupStart) {
      const gy = bodyTop + slot * rowH + rowH - 1.4;
      if (slot > 0) {
        body += `<line x1="${x0}" y1="${(bodyTop + slot * rowH).toFixed(2)}" x2="${x0 + tableW}" y2="${(bodyTop + slot * rowH).toFixed(2)}" stroke="${INK_100}" stroke-width="0.25"/>`;
      }
      body += `<text x="${x0}" y="${gy.toFixed(2)}" font-size="3.1" fill="${INK_900}" style="font-family:${FONT_UI};font-weight:600;letter-spacing:0.04em">${esc(r.groupLabel ?? "")}</text>`;
      slot += 1;
    }

    const y = bodyTop + slot * rowH + rowH - 1.4;
    const cells = [
      r.mark,
      r.room,
      r.wall,
      `${Math.round(r.width_mm)} × ${Math.round(r.height_mm)}`,
      r.sill_mm > 0 ? String(Math.round(r.sill_mm)) : "—",
      openingAreaM2(r).toFixed(2),
      r.source,
      // The honesty column: never let a defaulted size read as measured.
      r.derived ? "DERIVED — default" : "Measured",
    ];
    COLS.forEach((c, i) => {
      const val = cells[i]!;
      if (!val) return;
      const tx = c.align === "end" ? xs[i]! + c.w - 2 : xs[i]! + 1;
      const fill =
        c.key === "mark" ? INK_900 : c.key === "derived" && r.derived ? "#92400E" : INK_700;
      const weight = c.key === "mark" || (c.key === "derived" && r.derived) ? "600" : "400";
      const clipped = clip(val, c.w, c.font === FONT_MONO ? 1.9 : 1.7);
      body += `<text x="${tx.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="${c.align}" font-size="2.9" fill="${fill}" style="font-family:${c.font};font-weight:${weight}">${esc(clipped)}</text>`;
    });
    slot += 1;
  }

  // Totals strip — count + the exact area deducted from wall finishes, so the
  // schedule and the BoQ's net wall lines can be reconciled by eye.
  const totalArea = rows.reduce((s, r) => s + openingAreaM2(r), 0);
  const derivedCount = rows.filter((r) => r.derived).length;
  const footY = bodyTop + slot * rowH + rowH + 1;
  let foot = `<line x1="${x0}" y1="${(footY - rowH + 1).toFixed(2)}" x2="${x0 + tableW}" y2="${(footY - rowH + 1).toFixed(2)}" stroke="${INK_900}" stroke-width="0.3"/>`;
  foot += `<text x="${x0}" y="${footY.toFixed(2)}" font-size="2.9" fill="${INK_700}" style="font-family:${FONT_UI};font-weight:600">${rows.length} opening${rows.length === 1 ? "" : "s"} — ${totalArea.toFixed(2)} m² deducted from wall plaster, paint and wet-area tiling${derivedCount > 0 ? ` · ${derivedCount} with DEFAULTED dimensions (not measured)` : ""}</text>`;

  const zebra = `<rect x="${xs[5]! - 0.5}" y="${bodyTop}" width="${COLS[5]!.w}" height="${(slot * rowH).toFixed(2)}" fill="${BONE}" fill-opacity="0.18"/>`;

  const body_g = `<g>${zebra}${head}${body}${foot}</g>`;
  return renderSheet({
    meta,
    sheetNumber: sheet.sheetNumber,
    title: sheet.title,
    body: body_g,
    showNorthScale: false,
  });
}

/** Rough character clip so long values don't overrun their column. */
function clip(s: string, colW: number, perChar: number): string {
  const max = Math.max(4, Math.floor((colW - 2) / perChar));
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

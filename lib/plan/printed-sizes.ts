// =============================================================================
// lib/plan/printed-sizes.ts — rooms against the size the sheet prints (15 Oct).
// PURE.
//
// When the drawing prints a room's size ("3985X5000"), the reading keeps it as
// the room's area (`area_source: "measured"` on parsed_json.rooms — reconcile
// sets it; repair never overwrites it). The OUTLINE can still disagree: Mudon's
// re-read drew rooms 1.5× too tall while their areas stayed the printed ones.
// Two uses, one source:
//   - the 01 Plan check flags a room whose outline area, at the plan's own
//     metre scale (the one the BoQ measures with — buildPlanGraph's
//     total_area_m2 / Σ outline area), is more than 10% off its printed size;
//   - "Fix overlaps" trims the room that is further over its printed size
//     (lib/plan/trim-overlaps.ts `printed_m2`).
//
// A database room is matched to its printed size by NAME (+ type when both
// carry one): ids do not survive the parse (see lib/parse/disputes.ts). A name
// printed twice ("Bath", "Bath") is ambiguous and left out — flagging the wrong
// room is worse than not flagging. A renamed room loses its printed size, which
// is right: the person renaming it has taken over from the sheet.
// =============================================================================

import { polygonArea, type Pt } from "./polygon";

/** A room is flagged when its outline is more than this far off its printed size. */
export const PRINTED_TOLERANCE = 0.1;

export interface PrintedSize {
  name: string;
  room_type: string | null;
  printed_m2: number;
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** The sizes the sheet printed, from a plan's parsed_json. Never throws. */
export function printedSizesFromParsedJson(parsedJson: unknown): PrintedSize[] {
  if (!parsedJson || typeof parsedJson !== "object") return [];
  const root = parsedJson as { rooms?: unknown };
  if (!Array.isArray(root.rooms)) return [];
  const out: PrintedSize[] = [];
  for (const r of root.rooms) {
    if (!r || typeof r !== "object") continue;
    const { name_en, room_type, area_m2, area_source } = r as Record<string, unknown>;
    if (area_source !== "measured" || typeof area_m2 !== "number" || !(area_m2 > 0) || typeof name_en !== "string" || !name_en.trim()) continue;
    out.push({ name: name_en, room_type: typeof room_type === "string" ? room_type : null, printed_m2: area_m2 });
  }
  return out;
}

/** Database room id → printed m², for the rooms the sheet names unambiguously. */
export function matchPrintedSizes(
  rooms: readonly { id: string; name_en?: string | null; room_type?: string | null }[],
  printed: readonly PrintedSize[],
): Map<string, number> {
  const byName = new Map<string, PrintedSize[]>();
  for (const p of printed) byName.set(norm(p.name), [...(byName.get(norm(p.name)) ?? []), p]);
  const roomsByName = new Map<string, number>();
  for (const r of rooms) roomsByName.set(norm(r.name_en), (roomsByName.get(norm(r.name_en)) ?? 0) + 1);
  const out = new Map<string, number>();
  for (const r of rooms) {
    const n = norm(r.name_en);
    const cands = byName.get(n);
    if (!cands || cands.length !== 1 || roomsByName.get(n) !== 1) continue;
    const p = cands[0]!;
    if (p.room_type && r.room_type && norm(p.room_type) !== norm(r.room_type)) continue;
    out.set(r.id, p.printed_m2);
  }
  return out;
}

const asPoly = (p: unknown): Pt[] | null =>
  Array.isArray(p) && p.length >= 3 && p.every((q) => Array.isArray(q) && q.length >= 2 && q.every((v) => typeof v === "number" && Number.isFinite(v)))
    ? (p as number[][]).map(([x, y]) => [x!, y!] as Pt)
    : null;

/**
 * m² per polygon unit², as buildPlanGraph measures: the plan's total over the
 * rooms' outline area (Σ area_m2 when the plan carries no total).
 */
export function planM2PerUnit2(rooms: readonly { polygon: unknown; area_m2?: number | null }[], totalAreaM2: number | null): number | null {
  let units = 0;
  for (const r of rooms) {
    const poly = asPoly(r.polygon);
    if (poly) units += polygonArea(poly);
  }
  const total = totalAreaM2 && totalAreaM2 > 0 ? totalAreaM2 : rooms.reduce((s, r) => s + (typeof r.area_m2 === "number" ? r.area_m2 : 0), 0);
  return units > 0 && total > 0 ? total / units : null;
}

export interface PrintedSizeFlag {
  id: string;
  name: string;
  outline_m2: number;
  printed_m2: number;
  /** outline / printed − 1 (0.25 = 25% over). */
  off: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Rooms whose outline is more than 10% off the size the sheet prints, largest miss first. */
export function printedSizeCheck(
  rooms: readonly { id: string; name_en?: string | null; polygon: unknown }[],
  printed: ReadonlyMap<string, number>,
  m2PerUnit2: number | null,
): PrintedSizeFlag[] {
  if (!m2PerUnit2) return [];
  const out: PrintedSizeFlag[] = [];
  for (const r of rooms) {
    const p = printed.get(r.id);
    const poly = asPoly(r.polygon);
    if (!p || !poly) continue;
    const outline = polygonArea(poly) * m2PerUnit2;
    const off = outline / p - 1;
    if (Math.abs(off) > PRINTED_TOLERANCE + 1e-9) out.push({ id: r.id, name: r.name_en ?? "Room", outline_m2: round1(outline), printed_m2: round1(p), off });
  }
  return out.sort((a, b) => Math.abs(b.off) - Math.abs(a.off));
}

/** "Bedroom 3 is drawn at 28.4 m² — the sheet prints 19.9 m² (43% over)." */
export function printedSizeSentence(f: PrintedSizeFlag): string {
  const pct = Math.round(Math.abs(f.off) * 100);
  return `${f.name} is drawn at ${f.outline_m2.toFixed(1)} m² — the sheet prints ${f.printed_m2.toFixed(1)} m² (${pct}% ${f.off > 0 ? "over" : "under"}).`;
}

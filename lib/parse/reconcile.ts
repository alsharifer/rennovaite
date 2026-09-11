// =============================================================================
// lib/parse/reconcile.ts — the drawing's own labels outrank the vision parse.
//
// A vision model looking at a rasterised plan is guessing at room outlines. It
// is NOT guessing at the room's name or its printed size: those are text the
// architect typed, and we read them straight out of the PDF with coordinates.
// So the two inputs are combined by authority, not by averaging:
//
//   from the sheet   room set, tag, name, area        (authoritative)
//   from the model   which polygon is which room, adjacency, layout   (a guess)
//
// MATCHING IS GLOBAL, not first-come. Every (label, room) pair is scored on
// three independent signals — does the room's name look like the label's, does
// the room's polygon contain the label's anchor, how far apart are they — and
// the highest-scoring pairs are taken first across the whole plan. Walking the
// labels in tag order and letting each grab the best room still free gets this
// badly wrong: a small room whose tag falls inside a neighbour's overstated
// rectangle claims the neighbour, and every later label is pushed off by one.
// Measured on the pilot sheet that renamed Bedroom 3 to "Passage" and invented
// five rooms that already existed.
//
// A label with no polygon at all is still a room — the drawing says so. It is
// added with geometry sized from its printed dimensions and positioned on its
// anchor, marked `geometry_derived` and dropped below the low-confidence flag so
// the editor asks someone to look. Inventing a rectangle is a real cost; losing
// a room the drawing names is a worse one, and this way the invention is
// labelled rather than hidden.
//
// Pure: no PDF, no I/O, no model. Unit-tested.
// =============================================================================

import { LOW_CONFIDENCE_FLAG } from "./constants";
import { titleCaseRoomName } from "./sheet/labels";
import { pointToRegionNorm } from "./sheet/region";
import type { Region, SheetRoomLabel, SheetScale } from "./sheet/types";
import type { RawParsedRoom } from "./providers/types";

/** How far (in normalised units) a label's anchor may sit from a room's centre
 *  and still count as near it. Beyond this, proximity contributes nothing. */
export const ANCHOR_PROXIMITY_RADIUS = 0.25;

/** Pair scoring. A name that matches is the strongest signal because the model
 *  read the same printed text we did; containment is the next; proximity only
 *  breaks ties between rooms that already look right. */
const W_NAME = 3;
const W_CONTAINS = 2;
const W_NEAR = 1;

/** Below this a pair is not a match at all. Equal to containment alone, or to a
 *  third of the label's words appearing in the room's name. */
export const MATCH_SCORE_FLOOR = 1;

/** Confidence given to a room that exists only because the sheet names it.
 *  Below LOW_CONFIDENCE_FLAG on purpose: its geometry is a placeholder. */
export const LABEL_ONLY_CONFIDENCE = 0.35;

/** Room a label creates when the model saw nothing there, sized from the
 *  printed dimensions when there are any, else a small default square. */
const DEFAULT_LABEL_ROOM_M2 = 4;

export interface ReconcileSummary {
  labels_total: number;
  /** Labels matched to a polygon the model produced. */
  labels_matched: number;
  /** Room ids whose name came from the sheet rather than the model. */
  renamed_room_ids: string[];
  /** Room ids whose area came from a printed dimension. */
  label_area_room_ids: string[];
  /** Rooms that exist only because the sheet names them; geometry is derived. */
  label_only_room_ids: string[];
  /** Tags the sheet prints that no room could be produced for. */
  unmatched_tags: string[];
  /** Rooms the model found that the sheet does not tag (stairs, niches). */
  untagged_room_ids: string[];
}

export interface ReconcileResult {
  rooms: RawParsedRoom[];
  summary: ReconcileSummary;
}

type Pt = [number, number];

function centroid(poly: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p[0];
    y += p[1];
  }
  return [x / poly.length, y / poly.length];
}

function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** Two words match when they are equal, or when one is a prefix of the other
 *  and at least four characters long — "dress" is "dressing", "bed" is not
 *  "bedroom" by accident. */
function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short);
}

/**
 * Share of the LABEL's words that appear in the room's name, 0..1.
 *
 * The denominator is the label's word count, not the longer of the two, because
 * the question is "does this room answer to what the drawing calls it" — and a
 * model that writes "Front Balcony (Bedroom 4)" for the sheet's "F-BALCONY" has
 * answered it. Dividing by the longer name punished exactly the descriptive
 * names the model is most confident about, and left a real balcony unmatched
 * while a phantom one was invented on top of it.
 */
function nameScore(labelName: string | null, roomName: string): number {
  if (!labelName) return 0;
  const a = tokens(labelName);
  const b = tokens(roomName);
  if (a.length === 0 || b.length === 0) return 0;
  const hits = a.filter((t) => b.some((u) => wordsMatch(t, u))).length;
  return hits / a.length;
}

/** A rectangle of `area_m2` on the drawing's aspect ratio, centred on `at`. */
function placeholderPolygon(
  at: Pt,
  label: SheetRoomLabel,
  scale: SheetScale,
  region: Region,
): Pt[] {
  const regionWpt = region[2] - region[0];
  const regionHpt = region[3] - region[1];
  let halfW = 0.03;
  let halfH = 0.03;
  if (label.dim_mm && scale.mm_per_pt && regionWpt > 0 && regionHpt > 0) {
    halfW = label.dim_mm[0] / scale.mm_per_pt / regionWpt / 2;
    halfH = label.dim_mm[1] / scale.mm_per_pt / regionHpt / 2;
  }
  const clamp = (v: number) => Math.min(0.999, Math.max(0.001, v));
  const x0 = clamp(at[0] - halfW);
  const x1 = clamp(at[0] + halfW);
  const y0 = clamp(at[1] - halfH);
  const y1 = clamp(at[1] + halfH);
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

function slugFor(label: SheetRoomLabel, taken: Set<string>): string {
  const base = (label.name ?? label.tag)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  let id = `${base || "room"}-${label.tag.toLowerCase()}`;
  let n = 2;
  while (taken.has(id)) id = `${base}-${label.tag.toLowerCase()}-${n++}`;
  taken.add(id);
  return id;
}

/**
 * Fold the sheet's printed room labels into a vision parse.
 *
 * `rooms` are the model's rooms in [0,1] over the CROPPED region; `labels` are
 * in PDF points on the page, so `region` is how the two spaces are related.
 */
export function reconcileWithSheet(
  rooms: RawParsedRoom[],
  labels: SheetRoomLabel[],
  region: Region,
  scale: SheetScale,
): ReconcileResult {
  const out: RawParsedRoom[] = rooms.map((r) => ({ ...r }));
  const taken = new Set(out.map((r) => r.id));
  const claimed = new Set<number>();
  const summary: ReconcileSummary = {
    labels_total: labels.length,
    labels_matched: 0,
    renamed_room_ids: [],
    label_area_room_ids: [],
    label_only_room_ids: [],
    unmatched_tags: [],
    untagged_room_ids: [],
  };

  const anchors = labels.map((l) => pointToRegionNorm(l.anchor_pt, region));

  // Score every pair, then take the best ones across the whole plan. Candidates
  // are the model's ORIGINAL rooms — a room this pass invents must never be
  // claimed by another label.
  const scored: { li: number; ri: number; score: number }[] = [];
  for (let li = 0; li < labels.length; li++) {
    const label = labels[li]!;
    const anchor = anchors[li]!;
    for (let ri = 0; ri < rooms.length; ri++) {
      const room = out[ri]!;
      if (room.polygon.length < 3) continue;
      const contains = pointInPolygon(anchor, room.polygon) ? 1 : 0;
      const [cx, cy] = centroid(room.polygon);
      const dist = Math.hypot(cx - anchor[0], cy - anchor[1]);
      const near = Math.max(0, 1 - dist / ANCHOR_PROXIMITY_RADIUS);
      const score =
        W_NAME * nameScore(label.name, room.name_en) + W_CONTAINS * contains + W_NEAR * near;
      if (score >= MATCH_SCORE_FLOOR) scored.push({ li, ri, score });
    }
  }
  // Deterministic: ties break on label order, then room order.
  scored.sort((a, b) => b.score - a.score || a.li - b.li || a.ri - b.ri);

  const labelToRoom = new Map<number, number>();
  for (const pair of scored) {
    if (labelToRoom.has(pair.li) || claimed.has(pair.ri)) continue;
    labelToRoom.set(pair.li, pair.ri);
    claimed.add(pair.ri);
  }

  for (let li = 0; li < labels.length; li++) {
    const label = labels[li]!;
    const ri = labelToRoom.get(li);

    if (ri !== undefined) {
      summary.labels_matched++;
      const room = out[ri]!;
      if (label.name) {
        const named = titleCaseRoomName(label.name);
        if (named !== room.name_en) summary.renamed_room_ids.push(room.id);
        room.name_en = named;
      }
      if (label.area_m2 !== null && label.area_m2 > 0) {
        room.area_m2 = label.area_m2;
        room.area_source = "measured";
        summary.label_area_room_ids.push(room.id);
      }
      continue;
    }

    // No room at all. The drawing still names this one.
    if (label.area_m2 === null && label.name === null) {
      summary.unmatched_tags.push(label.tag);
      continue;
    }
    const id = slugFor(label, taken);
    out.push({
      id,
      name_en: label.name ? titleCaseRoomName(label.name) : label.tag,
      name_ar: null,
      room_type: "other",
      area_m2: label.area_m2 ?? DEFAULT_LABEL_ROOM_M2,
      area_source: label.area_m2 !== null ? "measured" : "estimated",
      polygon: placeholderPolygon(anchors[li]!, label, scale, region),
      confidence: Math.min(LABEL_ONLY_CONFIDENCE, LOW_CONFIDENCE_FLAG - 0.05),
    });
    summary.label_only_room_ids.push(id);
    if (label.area_m2 !== null) summary.label_area_room_ids.push(id);
  }

  for (let i = 0; i < rooms.length; i++) {
    if (!claimed.has(i)) summary.untagged_room_ids.push(out[i]!.id);
  }
  return { rooms: out, summary };
}

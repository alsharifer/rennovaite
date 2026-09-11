// =============================================================================
// lib/parse/sheet/labels.ts — read the rooms a CAD sheet names.
//
// On a vector construction drawing the room tags (F01…), the room names and the
// NNNNxNNNN dimension labels are real text with real coordinates. They are what
// the architect typed. Nothing a vision model infers from a rasterised page can
// be more authoritative than that, so this is the room set the parse is
// reconciled against.
//
// What is NOT here, deliberately: the dimension CHAINS along the grid lines
// (2725 / 4470 / 19910 on the pilot sheet). The CAD export drew those digits as
// vector strokes, not text, so no amount of text extraction recovers them. The
// per-room labels are the ones that carry the areas anyway.
//
// Pure: takes text lines in PDF points, returns rooms. No PDF, no I/O.
// =============================================================================

import type { SheetRoomLabel, SheetTextLine } from "./types";

/** "F01", "F 01", "R12" — a letter and two digits is the near-universal room
 *  tag on GCC residential sheets. Tags are matched on their own line because
 *  that is how CAD boxes them. */
const TAG_RE = /^([A-Z])\s?(\d{2})$/;

/** "3985X5000" — width x height in millimetres. */
const DIM_RE = /^(\d{3,5})\s*[xX*]\s*(\d{3,5})$/;

/** How far below a tag its name and dimension can sit, in points. Sized for a
 *  tag box plus two 7 pt text lines with leading. */
const BELOW_PT = 42;
/** How far ABOVE a tag its name can sit. Some tags are placed under the name
 *  when the room is tight (the pilot sheet does this for one balcony). */
const ABOVE_PT = 14;
/** Horizontal window around the tag's centre, in points. */
const SIDE_PT = 34;

/** Text that sits near a room tag but never names a room. */
const NOT_A_ROOM_NAME = /^(\+?\d+\.\d+|F\.F\.L|S\.S\.L|DN|UP|D\d|W\d+[A-Z]?|FD\d)$/i;

function centre(l: SheetTextLine): [number, number] {
  return [l.x + l.w / 2, l.y + l.h / 2];
}

/**
 * Every room the sheet tags, with its printed name, dimension and position.
 *
 * Ordering is by tag so the output is stable regardless of the PDF's drawing
 * order — a fixture that reshuffles on re-extraction is worse than no fixture.
 */
export function extractRoomLabels(lines: SheetTextLine[]): SheetRoomLabel[] {
  const usable = lines
    .map((l) => ({ ...l, text: l.text.trim() }))
    .filter((l) => l.text.length > 0);

  const tags = usable.filter((l) => TAG_RE.test(l.text));
  if (tags.length === 0) return [];

  // Only the dominant tag letter counts. A sheet can carry door tags (D2) and
  // window tags (W4) in the same shape; the room series is the populous one.
  const byLetter = new Map<string, typeof tags>();
  for (const t of tags) {
    const letter = TAG_RE.exec(t.text)![1]!;
    const bucket = byLetter.get(letter) ?? [];
    bucket.push(t);
    byLetter.set(letter, bucket);
  }
  const [, roomTags] = [...byLetter.entries()].sort((a, b) => b[1].length - a[1].length)[0]!;

  const out: SheetRoomLabel[] = [];
  for (const tag of roomTags) {
    const [tcx, tcy] = centre(tag);
    const near = usable
      .filter((l) => l !== tag)
      .map((l) => ({ l, c: centre(l) }))
      .filter(
        ({ l, c }) =>
          !TAG_RE.test(l.text) &&
          c[1] - tcy > -ABOVE_PT &&
          c[1] - tcy < BELOW_PT &&
          Math.abs(c[0] - tcx) < SIDE_PT,
      )
      .sort((a, b) => a.c[1] - b.c[1]);

    const dimLine = near.find(({ l }) => DIM_RE.test(l.text));
    const dim = dimLine ? DIM_RE.exec(dimLine.l.text)! : null;
    const nameParts = near
      .filter(({ l }) => !DIM_RE.test(l.text) && !NOT_A_ROOM_NAME.test(l.text))
      .map(({ l }) => l.text);

    const m = TAG_RE.exec(tag.text)!;
    const dimMm: [number, number] | null = dim ? [Number(dim[1]), Number(dim[2])] : null;
    out.push({
      tag: `${m[1]}${m[2]}`,
      name: nameParts.length > 0 ? nameParts.join(" ") : null,
      dim_mm: dimMm,
      area_m2: dimMm ? Math.round(((dimMm[0] * dimMm[1]) / 1e6) * 100) / 100 : null,
      anchor_pt: [Math.round(tcx * 10) / 10, Math.round(tcy * 10) / 10],
    });
  }
  out.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  return out;
}

/** "MASTER BEDROOM" → "Master Bedroom". CAD names are upper case; the app is
 *  not. Words already mixed-case are left alone. */
export function titleCaseRoomName(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((word) =>
      word
        .split("-")
        .map((part) => (part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part))
        .join("-"),
    )
    .join(" ");
}

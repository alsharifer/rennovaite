// =============================================================================
// lib/plan/openings-detect.ts — find windows, doors and openings on the drawing
// (R10b, spec §7.5). SERVER-ONLY (Anthropic, mupdf, resvg).
//
// 1 of 10 production plans had an opening recorded (5, all drawn by hand) and
// the parser extracts none — so every off-plan render was told "a single window
// on one side wall" and the walkthrough's dining room (a kitchen opening on the
// left, floor-to-ceiling windows on the right) could never come out right.
//
// How it reads a drawing:
//
//   1. The drawing is rasterised in the SAME frame the room polygons are in —
//      the parser's crop for a vector sheet it cropped, the whole page for a PDF
//      it read whole, the image itself for a photo or scan.
//   2. The model is shown the clean drawing AND the same drawing with the
//      rooms as the app holds them outlined and labelled R1…Rn over a 0.1 grid.
//      It names each opening by its room, the SIDE of the room its wall is on
//      and where along that side it starts and ends — relative to the room,
//      because the app's outlines often sit off the drawn walls (a reading
//      traces rooms roughly), and a point on the sheet would then miss them.
//   3. `snapProposals` (pure) puts every proposal on the wall of the app's room
//      on that side (`deriveWallSegments` — the editor's and buildPlanGraph's
//      walls), sizes it as that fraction of the room's side at the plan's own
//      metre scale, and merges the same opening seen from both of its rooms.
//
// THE FRAME. A plan saved from the editor stores its polygons in the editor's
// 1000 × 600 viewBox, fitted to the rooms — not in the drawing's 0–1 frame. The
// original reading (parsed_json.rooms) still is, so `drawingFrame` fits the
// editor's uniform scale + offset on the rooms both share by name (rooms the
// owner moved fall out as outliers); the model is shown the rooms in the
// drawing's frame and its answers come back into the stored frame before they
// are snapped. A plan whose stored rooms cannot be related to the drawing is
// not guessed at ("no_frame").
//
// What it writes: plan_openings rows with source 'detected', derived true and
// `detection` (the room it opens to, confidence, model). They are DERIVED until
// the owner confirms: they shape the renders at once, labelled, but
// derivePlanGraph leaves them out of every pricing and document path until
// confirmed (lib/plan/derive.ts). A re-detect replaces only the unconfirmed
// detected rows; a confirmed or hand-drawn opening is never touched, and a
// proposal that lands on one is dropped as already known.
// =============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { Resvg } from "@resvg/resvg-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { documentFontOptions } from "@/lib/documents/doc-fonts";
import { rasterizeRegion } from "@/lib/parse/sheet/read";
import type { Region } from "@/lib/parse/sheet/types";
import { imageSize } from "@/lib/scene-render/gate";

import { DEFAULT_OPENING_DIMS, deriveWallSegments, polygonArea, projectOntoSegment, type RawWallSegment } from "./geometry";
import { detectionRunning, type DetectionMeta, type DetectionRun } from "./openings-vocab";

export const DETECT_MODEL = "claude-opus-5";
/** Long edge the model is shown (its own resize threshold). */
export const DETECT_MAX_EDGE = 1568;

type Pt = [number, number];

export interface DetectRoom {
  id: string;
  name: string;
  room_type: string | null;
  polygon: Pt[];
  area_m2: number | null;
}

export type Side = "top" | "bottom" | "left" | "right";

/**
 * What the model says about one opening: the room it belongs to, which SIDE of
 * that room (as the drawing is shown) its wall is on, and where along that side
 * it starts and ends (0–1, left→right on top/bottom, top→bottom on left/right).
 * Relative to the room, not to the sheet — so it carries over onto the app's
 * room even where the app's outline sits off the drawn walls.
 */
export interface Proposal {
  kind: "door" | "window" | "archway";
  /** "R3". */
  room: string;
  /** "outside" | "R5" | "unknown". */
  opens_to: string;
  side: Side;
  start: number;
  end: number;
  floor_to_ceiling?: boolean;
  confidence: number;
  note?: string | null;
}

export interface SnappedOpening {
  kind: "door" | "window" | "archway";
  room_id: string;
  wall_ref: string;
  position: Pt;
  along_offset: number;
  width_mm: number;
  height_mm: number;
  sill_mm: number;
  detection: DetectionMeta;
}

export interface Dropped {
  proposal: Proposal;
  reason: string;
}

/** Plausible clear widths (mm). A proposal outside is clamped, never dropped — the owner adjusts it. */
const WIDTH_RANGE: Record<SnappedOpening["kind"], [number, number]> = {
  door: [600, 2400],
  window: [400, 8000],
  archway: [700, 8000],
};

/** The rooms' labels as the model sees them. */
export function roomLabels(rooms: readonly DetectRoom[]): Map<string, DetectRoom> {
  return new Map(rooms.map((r, i) => [`R${i + 1}`, r]));
}

/** Metres per normalised unit — exactly as buildPlanGraph derives it for a parsed plan. */
export function unitToMetres(rooms: readonly DetectRoom[], totalAreaM2: number | null): number {
  const normArea = rooms.reduce((s, r) => s + polygonArea(r.polygon), 0);
  const total = totalAreaM2 && totalAreaM2 > 0 ? totalAreaM2 : rooms.reduce((s, r) => s + (r.area_m2 ?? 0), 0);
  return normArea > 0 && total > 0 ? Math.sqrt(total / normArea) : 1;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Pure: the wall of `room` on the proposal's side, and where along it the
 * opening runs (t0..t1). The side is read off the room's bounding box: the
 * wall must run along that side, cover the point the fractions name, and be
 * the outermost such wall on that side of the room's centre.
 */
export function sidePlacement(room: DetectRoom, p: Pick<Proposal, "side" | "start" | "end">, walls: readonly RawWallSegment[]): { wall: RawWallSegment; t0: number; t1: number } | { reason: string } {
  const xs = room.polygon.map((q) => q[0]);
  const ys = room.polygon.map((q) => q[1]);
  const B = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  const horiz = p.side === "top" || p.side === "bottom";
  const lo = horiz ? B.minX : B.minY;
  const ext = horiz ? B.maxX - B.minX : B.maxY - B.minY;
  const a = clamp(Math.min(p.start, p.end), 0, 1);
  const b = clamp(Math.max(p.start, p.end), 0, 1);
  const s0 = lo + a * ext;
  const s1 = lo + b * ext;
  const c = (s0 + s1) / 2;
  const centreCross = horiz ? (B.minY + B.maxY) / 2 : (B.minX + B.maxX) / 2;
  const outward = p.side === "bottom" || p.side === "right" ? 1 : -1;
  const along = (q: Pt) => (horiz ? q[0] : q[1]);
  const cross = (q: Pt) => (horiz ? q[1] : q[0]);
  const eps = ext * 0.02;
  let best: { wall: RawWallSegment; score: number } | null = null;
  for (const w of walls) {
    if (!w.roomIds.includes(room.id)) continue;
    const da = Math.abs(along(w.b) - along(w.a));
    const dc = Math.abs(cross(w.b) - cross(w.a));
    if (da <= 0 || dc > 0.2 * da) continue; // not running along this side
    const wc = (cross(w.a) + cross(w.b)) / 2;
    if ((wc - centreCross) * outward <= 0) continue; // the other side of the room
    const covers = c >= Math.min(along(w.a), along(w.b)) - eps && c <= Math.max(along(w.a), along(w.b)) + eps;
    // Outermost covering wall first; a wall that does not cover the point only as a fallback.
    const score = (covers ? 0 : 1e6) - (wc - centreCross) * outward + (covers ? 0 : Math.min(Math.abs(c - along(w.a)), Math.abs(c - along(w.b))));
    if (!best || score < best.score) best = { wall: w, score };
  }
  if (!best) return { reason: `${room.name} has no wall on its ${p.side} side` };
  const w = best.wall;
  const wc = (cross(w.a) + cross(w.b)) / 2;
  const pt = (v: number): Pt => (horiz ? [v, wc] : [wc, v]);
  return { wall: w, t0: projectOntoSegment(pt(s0), w.a, w.b).t, t1: projectOntoSegment(pt(s1), w.a, w.b).t };
}

/**
 * Pure: proposals → openings on the plan's walls. `unitToM` is metres per
 * normalised unit (unitToMetres). `existing` are openings already on the plan
 * (confirmed or hand-drawn) — a proposal that lands on one is dropped.
 */
export function snapProposals(
  proposals: readonly Proposal[],
  rooms: readonly DetectRoom[],
  unitToM: number,
  opts: { model?: string; runAt?: string; existing?: readonly { position: Pt | null; width_mm: number }[] } = {},
): { openings: SnappedOpening[]; dropped: Dropped[] } {
  const labels = roomLabels(rooms);
  const walls = deriveWallSegments(rooms.map((r) => ({ id: r.id, polygon: r.polygon, room_type: r.room_type })));
  const dropped: Dropped[] = [];
  const placed: (SnappedOpening & { proposal: Proposal })[] = [];

  for (const p of proposals) {
    const room = labels.get(p.room.trim().toUpperCase());
    if (!room) {
      dropped.push({ proposal: p, reason: `no room ${p.room}` });
      continue;
    }
    const place = sidePlacement(room, p, walls);
    if ("reason" in place) {
      dropped.push({ proposal: p, reason: place.reason });
      continue;
    }
    const w = place.wall;
    const lenRaw = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const lenMm = lenRaw * unitToM * 1000;
    const def = DEFAULT_OPENING_DIMS[p.kind];
    const measured = Math.abs(place.t1 - place.t0) * lenMm;
    const [lo, hi] = WIDTH_RANGE[p.kind];
    let width = measured >= 200 ? clamp(measured, lo, hi) : def.width_mm;
    width = Math.round(Math.min(width, lenMm) / 10) * 10;
    if (width <= 0) {
      dropped.push({ proposal: p, reason: "wall too short" });
      continue;
    }
    const half = lenMm > 0 ? width / 2 / lenMm : 0;
    const t = clamp((place.t0 + place.t1) / 2, half, 1 - half);
    const position: Pt = [r4(w.a[0] + (w.b[0] - w.a[0]) * t), r4(w.a[1] + (w.b[1] - w.a[1]) * t)];

    // What it opens to: the wall's own other room wins; else what the model said. A window
    // the model read as external stays external — the app's outlines can make an outside
    // wall look shared (a bedroom window "to the toilet").
    const saidOutside = p.opens_to.trim().toLowerCase() === "outside";
    const wallOther = p.kind === "window" && saidOutside ? null : (w.roomIds.find((id) => id !== room.id) ?? null);
    const saidRoom = labels.get(p.opens_to.trim().toUpperCase()) ?? null;
    const otherId = wallOther ?? (saidRoom && saidRoom.id !== room.id ? saidRoom.id : null);
    const opensTo: DetectionMeta["opens_to"] = otherId ? "room" : p.opens_to.trim().toLowerCase() === "outside" ? "outside" : null;
    const ftc = p.kind === "window" && p.floor_to_ceiling === true;

    placed.push({
      kind: p.kind,
      room_id: room.id,
      wall_ref: w.id,
      position,
      along_offset: r4(t),
      width_mm: width,
      height_mm: ftc ? 2600 : def.height_mm,
      sill_mm: ftc ? 0 : def.sill_mm,
      detection: {
        opens_to_room_id: otherId,
        opens_to: opensTo,
        ...(ftc ? { floor_to_ceiling: true } : {}),
        confidence: Math.round(clamp(p.confidence, 0, 1) * 100) / 100,
        note: p.note?.trim() ? p.note.trim().slice(0, 300) : null,
        read: { side: p.side, start: Math.round(p.start * 1000) / 1000, end: Math.round(p.end * 1000) / 1000 },
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.runAt ? { run_at: opts.runAt } : {}),
      },
      proposal: p,
    });
  }

  // The same opening named from both of its rooms, or twice: keep the surer one.
  const near = (a: { position: Pt; width_mm: number }, b: { position: Pt | null; width_mm: number }) => {
    if (!b.position) return false;
    const d = Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]) * unitToM * 1000;
    return d < Math.max(a.width_mm, b.width_mm) * 0.6;
  };
  const kept: (SnappedOpening & { proposal: Proposal })[] = [];
  for (const o of [...placed].sort((a, b) => (b.detection.confidence ?? 0) - (a.detection.confidence ?? 0))) {
    const twin = kept.find((k) => near(o, k) && (k.kind === o.kind || k.room_id === o.detection.opens_to_room_id || o.room_id === k.detection.opens_to_room_id));
    if (twin) {
      dropped.push({ proposal: o.proposal, reason: "same opening seen twice" });
      continue;
    }
    if ((opts.existing ?? []).some((e) => near(o, e))) {
      dropped.push({ proposal: o.proposal, reason: "already on the plan" });
      continue;
    }
    kept.push(o);
  }
  // Stable order: by room, then along the wall.
  const order = new Map(rooms.map((r, i) => [r.id, i]));
  kept.sort((a, b) => (order.get(a.room_id)! - order.get(b.room_id)!) || a.wall_ref.localeCompare(b.wall_ref, undefined, { numeric: true }) || a.along_offset - b.along_offset);
  return { openings: kept.map((o) => {
      const { proposal, ...rest } = o;
      void proposal;
      return rest;
    }), dropped };
}

// --- stored rooms ↔ the drawing --------------------------------------------------

export interface Frame {
  /** identity: already in the drawing's frame · matched: fitted on rooms the plan and the reading share · parse_bbox: the two extents. */
  kind: "identity" | "matched" | "parse_bbox";
  toDrawing: (p: Pt) => Pt;
  fromDrawing: (p: Pt) => Pt;
  /** matched: rooms the fit rests on; parse_bbox: x-scale ÷ y-scale − 1. */
  skew: number;
  pairs?: number;
  /** matched: RMS residual of the fit, in drawing units (0–1). */
  rms?: number;
}

function bbox(polys: readonly Pt[][]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polys) for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return Number.isFinite(minX) && maxX > minX && maxY > minY ? { minX, minY, maxX, maxY } : null;
}

/** Normalised drawing coordinates never reach this; the editor's 1000 × 600 viewBox always does. */
const UNIT_MAX = 2;

const normName = (n: unknown) => String(n ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Least squares parse = s·stored + t (uniform s — the editor's fit is uniform). */
function fitUniform(pairs: readonly [Pt, Pt][]): { s: number; tx: number; ty: number; res: number[] } | null {
  const n = pairs.length;
  if (n < 2) return null;
  const mx = pairs.reduce((a, [p]) => a + p[0], 0) / n;
  const my = pairs.reduce((a, [p]) => a + p[1], 0) / n;
  const MX = pairs.reduce((a, [, q]) => a + q[0], 0) / n;
  const MY = pairs.reduce((a, [, q]) => a + q[1], 0) / n;
  let num = 0, den = 0;
  for (const [p, q] of pairs) {
    num += (p[0] - mx) * (q[0] - MX) + (p[1] - my) * (q[1] - MY);
    den += (p[0] - mx) ** 2 + (p[1] - my) ** 2;
  }
  if (!(den > 0) || !(num > 0)) return null;
  const sc = num / den;
  const tx = MX - sc * mx;
  const ty = MY - sc * my;
  return { s: sc, tx, ty, res: pairs.map(([p, q]) => Math.hypot(sc * p[0] + tx - q[0], sc * p[1] + ty - q[1])) };
}

/**
 * Pure: how the stored room polygons relate to the drawing's 0–1 frame.
 *
 *   identity    they are already in it (a plan never saved from the editor)
 *   matched     the editor's uniform scale + offset, fitted on the corners of
 *               the rooms the stored plan and the original reading share by
 *               name; rooms the owner moved fall out as outliers
 *   parse_bbox  too few shared rooms: the two extents
 *
 * Null when there is no reading to relate them to.
 */
export function drawingFrame(rooms: readonly (Pick<DetectRoom, "polygon"> & { name?: string })[], parsedJson: unknown): Frame | null {
  const stored = bbox(rooms.map((r) => r.polygon));
  if (!stored) return null;
  // A reading can run a little past its frame (a cropped sheet's label just outside the crop:
  // 1.05 seen); editor-saved polygons are in the hundreds. So "unit" is anything up to 2.
  const inUnit = stored.minX >= -1 && stored.minY >= -1 && stored.maxX <= UNIT_MAX && stored.maxY <= UNIT_MAX;
  if (inUnit) return { kind: "identity", toDrawing: (p) => p, fromDrawing: (p) => p, skew: 0 };
  const parsedRooms = (parsedJson as { rooms?: { polygon?: unknown; name_en?: unknown }[] } | null)?.rooms;
  const parsed = (Array.isArray(parsedRooms) ? parsedRooms : []).map((r) => ({ name: normName(r?.name_en), poly: toPolygon(r?.polygon) })).filter((r): r is { name: string; poly: Pt[] } => r.poly !== null);
  const parse = bbox(parsed.map((r) => r.poly));
  if (!parse || parse.maxX > UNIT_MAX || parse.maxY > UNIT_MAX || parse.minX < -1 || parse.minY < -1) return null;

  // Rooms named once on each side are the same room.
  const count = (names: string[]) => names.reduce((m, n) => m.set(n, (m.get(n) ?? 0) + 1), new Map<string, number>());
  const sc = count(rooms.map((r) => normName(r.name)));
  const pc = count(parsed.map((r) => r.name));
  let pairs: [Pt, Pt][] = [];
  for (const r of rooms) {
    const n = normName(r.name);
    if (!n || sc.get(n) !== 1 || pc.get(n) !== 1) continue;
    const q = parsed.find((x) => x.name === n)!;
    const a = bbox([r.polygon])!;
    const b = bbox([q.poly])!;
    if (!a || !b) continue;
    pairs.push([[a.minX, a.minY], [b.minX, b.minY]], [[a.maxX, a.maxY], [b.maxX, b.maxY]]);
  }
  let fit = fitUniform(pairs);
  if (fit && pairs.length >= 6) {
    // One pass of outlier rejection: rooms the owner moved or redrew.
    const sorted = [...fit.res].sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const keep = pairs.filter((_, i) => fit!.res[i]! <= Math.max(3 * median, 0.01));
    if (keep.length >= 4 && keep.length < pairs.length) {
      const refit = fitUniform(keep);
      if (refit) {
        pairs = keep;
        fit = refit;
      }
    }
  }
  if (fit && pairs.length >= 4) {
    const { s: k, tx, ty, res } = fit;
    const rms = Math.sqrt(res.reduce((a, r) => a + r * r, 0) / res.length);
    return {
      kind: "matched",
      toDrawing: ([x, y]) => [k * x + tx, k * y + ty],
      fromDrawing: ([x, y]) => [(x - tx) / k, (y - ty) / k],
      skew: 0,
      pairs: pairs.length / 2,
      rms: Math.round(rms * 10_000) / 10_000,
    };
  }
  const sx = (parse.maxX - parse.minX) / (stored.maxX - stored.minX);
  const sy = (parse.maxY - parse.minY) / (stored.maxY - stored.minY);
  return {
    kind: "parse_bbox",
    toDrawing: ([x, y]) => [parse.minX + (x - stored.minX) * sx, parse.minY + (y - stored.minY) * sy],
    fromDrawing: ([x, y]) => [stored.minX + (x - parse.minX) / sx, stored.minY + (y - parse.minY) / sy],
    skew: Math.round((sx / sy - 1) * 1000) / 1000,
  };
}

// --- the drawing, in the polygons' frame ---------------------------------------

export interface Drawing {
  /** Encoded image (PNG or JPEG) in the polygons' frame. */
  bytes: Buffer;
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
  frame: "cropped" | "page" | "image";
}

function sheetRegion(parsedJson: unknown): Region | null {
  const sheet = (parsedJson as { parse?: { sheet?: { path?: string; region?: unknown } | null } } | null)?.parse?.sheet;
  if (sheet?.path !== "cropped" || !Array.isArray(sheet.region) || sheet.region.length !== 4) return null;
  const r = sheet.region.map(Number);
  return r.every(Number.isFinite) ? (r as Region) : null;
}

/** Fetch the plan's drawing and rasterise it in the frame its rooms were traced in. Null = nothing readable. */
export async function loadDrawing(url: string, parsedJson: unknown): Promise<Drawing | null> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`drawing fetch failed (${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const isPdf = bytes.subarray(0, 5).toString("latin1") === "%PDF-";
  if (isPdf) {
    const region = sheetRegion(parsedJson);
    const raster = await rasterizeRegion(bytes, region);
    if (!raster) return null;
    return { bytes: Buffer.from(raster.data, "base64"), mime: "image/png", width: raster.width, height: raster.height, frame: region ? "cropped" : "page" };
  }
  const size = imageSize(bytes);
  if (!size) return null;
  const mime = bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : null;
  if (!mime) return null;
  return { bytes, mime, width: size.width, height: size.height, frame: "image" };
}

const OUTLINE = ["#d6336c", "#1971c2", "#2f9e44", "#e8590c", "#7048e8", "#0c8599", "#c2255c", "#5c940d", "#f08c00", "#364fc7"];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Pure: the overlay SVG (the drawing + the rooms as the app holds them, labelled, on a 0.1 grid). */
export function overlaySvg(d: Pick<Drawing, "width" | "height" | "mime">, href: string, rooms: readonly DetectRoom[], withOverlay: boolean): string {
  const { width: W, height: H } = d;
  const s = Math.max(W, H);
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`, `<rect width="${W}" height="${H}" fill="#ffffff"/>`, `<image x="0" y="0" width="${W}" height="${H}" xlink:href="${href}"/>`];
  if (withOverlay) {
    const fs = Math.round(Math.max(12, s * 0.014));
    for (let i = 1; i < 10; i++) {
      const x = (W * i) / 10;
      const y = (H * i) / 10;
      parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#868e96" stroke-width="${s * 0.0008}" stroke-dasharray="${s * 0.006} ${s * 0.006}" opacity="0.5"/>`);
      parts.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#868e96" stroke-width="${s * 0.0008}" stroke-dasharray="${s * 0.006} ${s * 0.006}" opacity="0.5"/>`);
      parts.push(`<text x="${x + 3}" y="${fs}" font-family="JetBrains Mono" font-size="${fs * 0.8}" fill="#495057">${(i / 10).toFixed(1)}</text>`);
      parts.push(`<text x="3" y="${y - 3}" font-family="JetBrains Mono" font-size="${fs * 0.8}" fill="#495057">${(i / 10).toFixed(1)}</text>`);
    }
    rooms.forEach((r, i) => {
      const c = OUTLINE[i % OUTLINE.length]!;
      const pts = r.polygon.map(([x, y]) => `${(x * W).toFixed(1)},${(y * H).toFixed(1)}`).join(" ");
      parts.push(`<polygon points="${pts}" fill="${c}" fill-opacity="0.07" stroke="${c}" stroke-width="${(s * 0.0028).toFixed(2)}" stroke-linejoin="round"/>`);
    });
    rooms.forEach((r, i) => {
      const c = OUTLINE[i % OUTLINE.length]!;
      const cx = (r.polygon.reduce((a, p) => a + p[0], 0) / r.polygon.length) * W;
      const cy = (r.polygon.reduce((a, p) => a + p[1], 0) / r.polygon.length) * H;
      parts.push(`<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" font-family="IBM Plex Sans" font-weight="600" font-size="${fs * 1.3}" fill="${c}" stroke="#ffffff" stroke-width="${fs * 0.25}" paint-order="stroke">R${i + 1}</text>`);
      parts.push(`<text x="${cx.toFixed(1)}" y="${(cy + fs * 1.3).toFixed(1)}" text-anchor="middle" font-family="IBM Plex Sans" font-size="${fs * 0.85}" fill="${c}" stroke="#ffffff" stroke-width="${fs * 0.2}" paint-order="stroke">${esc(r.name)}</text>`);
    });
  }
  parts.push("</svg>");
  return parts.join("");
}

/** Render the clean drawing and the overlay, both at the model's size. */
export function renderViews(d: Drawing, rooms: readonly DetectRoom[]): { clean: Buffer; overlay: Buffer; width: number; height: number } {
  const href = `data:${d.mime};base64,${d.bytes.toString("base64")}`;
  const fit = Math.min(DETECT_MAX_EDGE, Math.max(d.width, d.height));
  const fitTo = d.width >= d.height ? ({ mode: "width", value: fit } as const) : ({ mode: "height", value: fit } as const);
  const clean = new Resvg(overlaySvg(d, href, rooms, false), { fitTo, font: documentFontOptions() }).render().asPng();
  const overlay = new Resvg(overlaySvg(d, href, rooms, true), { fitTo, font: documentFontOptions() }).render().asPng();
  const scale = fit / Math.max(d.width, d.height);
  return { clean: Buffer.from(clean), overlay: Buffer.from(overlay), width: Math.round(d.width * scale), height: Math.round(d.height * scale) };
}

// --- the model ------------------------------------------------------------------

const ProposalSchema = z.object({
  kind: z.enum(["door", "window", "archway"]),
  room: z.string(),
  opens_to: z.string().default("unknown"),
  side: z.enum(["top", "bottom", "left", "right"]),
  start: z.number(),
  end: z.number(),
  floor_to_ceiling: z.boolean().nullish(),
  confidence: z.number().min(0).max(1),
  note: z.string().nullish(),
});
const ResponseSchema = z.object({ openings: z.array(ProposalSchema).max(300) });

const SYSTEM_PROMPT = `You read architectural floor plans of Dubai villas and apartments for RenovAIte and list every window, door and open passage, so that renders of each room show its real openings.

You get two images of the SAME drawing at the same size:
  1. the drawing as it is;
  2. the drawing with the rooms as the app holds them — each outlined in its own colour and labelled R1, R2, … with its name.

The coloured outlines are APPROXIMATE: they can sit off the drawn walls, be larger or smaller than the drawn room, or cover part of a neighbouring room. Read the openings from the DRAWN walls, and give each one to the outlined room it belongs to (match by position and by the name printed in the drawing).

What counts:
- "window": glazing in an external wall — thin parallel lines (usually 2–3) drawn across the wall thickness, sometimes with a sill line. Check EVERY external wall of EVERY room; villas have many windows. Mark floor_to_ceiling true for full-height glazing — sliding glass doors to a balcony, terrace or garden, curtain walls, glazing drawn down to the floor.
- "door": a door leaf, drawn as a swing arc or a sliding leaf, between two rooms or to the outside (garage doors count).
- "archway": a gap in a wall with NO door between two spaces — e.g. an open kitchen to a dining area, a living room open to a hall.
- Ignore furniture, fixtures, stairs, dimension lines, text, and anything outside the outlined rooms.

For each opening give:
- kind: "door" | "window" | "archway"
- room: the label (R1, R2, …) of the room it belongs to; for an opening between two outlined rooms, either one
- opens_to: "outside", or the label of the room on the other side, or "unknown"
- side: which side of that room the wall is on, as the image is shown: "top" | "bottom" | "left" | "right"
- start, end: where the opening begins and ends along that side, as fractions 0–1 of the room's drawn side — left to right on a top or bottom side, top to bottom on a left or right side
- floor_to_ceiling: true or false (windows only)
- confidence: 0.0–1.0
- note: a few words if something is unclear, else null

List each opening once. If there are none, return an empty list.

Your ENTIRE response is one JSON object, no prose, no fences: {"openings": [ ... ]}`;

function stripFences(raw: string): string {
  const t = raw.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  return m ? m[1]!.trim() : t;
}

export type AskModel = (images: { clean: Buffer; overlay: Buffer }, roomTable: string, retry: string | null) => Promise<string>;

/** The production model call. */
export const askClaude: AskModel = async (images, roomTable, retry) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");
  const anthropic = new Anthropic({ apiKey });
  // Streamed: a long reading must not hang on one held-open request. Thinking
  // is configurable for the accuracy runs (DETECT_THINKING=on); off by default —
  // measured on the Jumeirah Parks plan: ~10 s off vs ~110 s on.
  const thinkingOn = process.env.DETECT_THINKING === "on";
  const response = await anthropic.messages.stream({
    model: DETECT_MODEL,
    max_tokens: thinkingOn ? 16000 : 8000,
    ...(thinkingOn ? {} : { thinking: { type: "disabled" as const } }),
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: images.clean.toString("base64") } },
          { type: "image", source: { type: "base64", media_type: "image/png", data: images.overlay.toString("base64") } },
          {
            type: "text",
            text: retry
              ? `Your previous reply could not be read as the required JSON:\n---\n${retry.slice(0, 4000)}\n---\nReply again with ONLY the JSON object {"openings": [...]}.\n\nRooms:\n${roomTable}`
              : `Rooms on this plan (label · name · type · approx. size):\n${roomTable}\n\nList every window, door and open passage.`,
          },
        ],
      },
    ],
  }).finalMessage();
  let out = "";
  for (const b of response.content) if (b.type === "text") out += b.text;
  return out;
};

/** "R1 · Dining room · dining · 4.2 × 5.1 m" per room. */
export function roomTable(rooms: readonly DetectRoom[], unitToM: number): string {
  return rooms
    .map((r, i) => {
      const xs = r.polygon.map((p) => p[0]);
      const ys = r.polygon.map((p) => p[1]);
      const w = (Math.max(...xs) - Math.min(...xs)) * unitToM;
      const h = (Math.max(...ys) - Math.min(...ys)) * unitToM;
      return `R${i + 1} · ${r.name} · ${r.room_type ?? "room"} · ${w.toFixed(1)} × ${h.toFixed(1)} m`;
    })
    .join("\n");
}

/** Pure: fractions given as percentages (it happens) back to 0–1. */
export function normaliseProposals(proposals: readonly Proposal[]): Proposal[] {
  return proposals.map((p) => (Math.max(p.start, p.end) > 1.5 ? { ...p, start: p.start / 100, end: p.end / 100 } : p));
}

/** Drawing + rooms (in their STORED frame) → snapped openings in that frame. Writes nothing. */
export async function detectOpenings(input: {
  drawing: Drawing;
  rooms: DetectRoom[];
  /** How the stored polygons map onto the drawing (drawingFrame). Default: they are in its frame. */
  frame?: Frame;
  totalAreaM2: number | null;
  existing?: { position: Pt | null; width_mm: number }[];
  ask?: AskModel;
  runAt?: string;
}): Promise<{ openings: SnappedOpening[]; dropped: Dropped[]; proposals: Proposal[] }> {
  const ask = input.ask ?? askClaude;
  const unitToM = unitToMetres(input.rooms, input.totalAreaM2);
  const frame = input.frame ?? { kind: "identity" as const, toDrawing: (p: Pt) => p, fromDrawing: (p: Pt) => p, skew: 0 };
  const shown = input.rooms.map((r) => ({ ...r, polygon: r.polygon.map(frame.toDrawing) }));
  const views = renderViews(input.drawing, shown);
  const table = roomTable(input.rooms, unitToM);
  let raw = await ask(views, table, null);
  let parsed = ResponseSchema.safeParse(safeJson(raw));
  if (!parsed.success) {
    raw = await ask(views, table, raw);
    parsed = ResponseSchema.safeParse(safeJson(raw));
    if (!parsed.success) throw new Error(`The opening detector's reply did not match the schema after one retry: ${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? ""} — ${raw.slice(0, 160)}`);
  }
  const proposals = normaliseProposals(parsed.data.openings.map((o) => ({ ...o, floor_to_ceiling: o.floor_to_ceiling === true, note: o.note ?? null })));
  // Sides are the same in both frames (the editor's fit is a uniform scale, no rotation).
  const snapped = snapProposals(proposals, input.rooms, unitToM, { model: DETECT_MODEL, runAt: input.runAt, existing: input.existing });
  return { ...snapped, proposals };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(stripFences(raw));
  } catch {
    return null;
  }
}

// --- the run (claims, writes) ----------------------------------------------------

export type DetectOutcome =
  | { status: "done"; found: number; dropped: number }
  | { status: "already" | "running"; run: DetectionRun | null }
  | { status: "no_drawing" }
  | { status: "no_frame" }
  | { status: "failed"; error: string };

interface PlanForDetect {
  id: string;
  pdf_url: string | null;
  parsed_json: unknown;
  total_area_m2: number | null;
  source: string | null;
  openings_detected_at: string | null;
  openings_detection: DetectionRun | null;
}

function toPolygon(v: unknown): Pt[] | null {
  if (!Array.isArray(v)) return null;
  const pts: Pt[] = [];
  for (const p of v) {
    if (!Array.isArray(p) || typeof p[0] !== "number" || typeof p[1] !== "number") return null;
    pts.push([p[0], p[1]]);
  }
  return pts.length >= 3 ? pts : null;
}

/**
 * Run detection for a plan. `auto` runs only if the plan was never claimed
 * (once, after reading or on first open); `redetect` runs again on demand
 * unless a run is in flight. The claim is a conditional update, so two tabs
 * opening the plan at once start one run.
 */
export async function runOpeningsDetection(db: SupabaseClient, planId: string, mode: "auto" | "redetect", deps: { ask?: AskModel; now?: () => Date; drawing?: typeof loadDrawing } = {}): Promise<DetectOutcome> {
  const now = deps.now ?? (() => new Date());
  const { data: plan, error } = await db
    .from("plans")
    .select("id, pdf_url, parsed_json, total_area_m2, source, openings_detected_at, openings_detection")
    .eq("id", planId)
    .maybeSingle<PlanForDetect>();
  if (error) throw new Error(error.message);
  if (!plan) throw new Error("plan_not_found");

  const startedAt = now().toISOString();
  const running: DetectionRun = { status: "running", started_at: startedAt, mode };
  if (mode === "auto") {
    if (plan.openings_detected_at) return { status: "already", run: plan.openings_detection };
    const claim = await db.from("plans").update({ openings_detected_at: startedAt, openings_detection: running }).eq("id", planId).is("openings_detected_at", null).select("id");
    if (claim.error) throw new Error(claim.error.message);
    if (!claim.data?.length) return { status: "already", run: plan.openings_detection };
  } else {
    if (detectionRunning(plan.openings_detection, now().getTime())) return { status: "running", run: plan.openings_detection };
    const prev = plan.openings_detected_at;
    let q = db.from("plans").update({ openings_detected_at: startedAt, openings_detection: running }).eq("id", planId);
    q = prev ? q.eq("openings_detected_at", prev) : q.is("openings_detected_at", null);
    const claim = await q.select("id");
    if (claim.error) throw new Error(claim.error.message);
    if (!claim.data?.length) return { status: "running", run: plan.openings_detection };
  }

  const finish = async (run: DetectionRun) => {
    await db.from("plans").update({ openings_detection: { ...run, started_at: startedAt, finished_at: now().toISOString(), mode } }).eq("id", planId);
  };

  if (!plan.pdf_url || plan.source === "user_drawn") {
    await finish({ status: "no_drawing" });
    return { status: "no_drawing" };
  }

  try {
    const roomsRes = await db.from("rooms").select("id, name_en, room_type, polygon, area_m2").eq("plan_id", planId).order("name_en");
    if (roomsRes.error) throw new Error(roomsRes.error.message);
    const rooms: DetectRoom[] = [];
    for (const r of (roomsRes.data ?? []) as { id: string; name_en: string | null; room_type: string | null; polygon: unknown; area_m2: number | null }[]) {
      const polygon = toPolygon(r.polygon);
      if (polygon) rooms.push({ id: r.id, name: r.name_en?.trim() || "Room", room_type: r.room_type, polygon, area_m2: r.area_m2 });
    }
    if (rooms.length === 0) {
      await finish({ status: "done", found: 0, dropped: 0, model: DETECT_MODEL });
      return { status: "done", found: 0, dropped: 0 };
    }
    const frame = drawingFrame(rooms, plan.parsed_json);
    if (!frame) {
      await finish({ status: "no_frame", error: "the rooms on this plan cannot be related to its drawing" });
      return { status: "no_frame" };
    }
    const drawing = await (deps.drawing ?? loadDrawing)(plan.pdf_url, plan.parsed_json);
    if (!drawing) {
      await finish({ status: "no_drawing" });
      return { status: "no_drawing" };
    }

    // Replace only what nobody confirmed; everything else is "already on the plan".
    const openingsRes = await db.from("plan_openings").select("id, source, confirmed_at, position, width_mm").eq("plan_id", planId);
    if (openingsRes.error) throw new Error(openingsRes.error.message);
    const rows = (openingsRes.data ?? []) as { id: string; source: string | null; confirmed_at: string | null; position: unknown; width_mm: number | null }[];
    const stale = rows.filter((o) => o.source === "detected" && !o.confirmed_at).map((o) => o.id);
    const existing = rows
      .filter((o) => !(o.source === "detected" && !o.confirmed_at))
      .map((o) => ({ position: Array.isArray(o.position) && o.position.length >= 2 ? ([Number(o.position[0]), Number(o.position[1])] as Pt) : null, width_mm: o.width_mm ?? 900 }));

    const result = await detectOpenings({ drawing, rooms, frame, totalAreaM2: plan.total_area_m2, existing, ask: deps.ask, runAt: startedAt });

    if (stale.length) {
      const del = await db.from("plan_openings").delete().in("id", stale);
      if (del.error) throw new Error(del.error.message);
    }
    if (result.openings.length) {
      const ins = await db.from("plan_openings").insert(
        result.openings.map((o) => ({
          plan_id: planId,
          room_id: o.room_id,
          wall_ref: o.wall_ref,
          kind: o.kind,
          width_mm: o.width_mm,
          height_mm: o.height_mm,
          sill_mm: o.sill_mm,
          position: o.position,
          along_offset: o.along_offset,
          source: "detected",
          derived: true,
          detection: o.detection,
        })),
      );
      if (ins.error) throw new Error(ins.error.message);
    }
    await finish({ status: "done", found: result.openings.length, dropped: result.dropped.length, model: DETECT_MODEL });
    return { status: "done", found: result.openings.length, dropped: result.dropped.length };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[openings-detect] failed", planId, message);
    await finish({ status: "failed", error: message.slice(0, 300) });
    return { status: "failed", error: message };
  }
}

/** Reset a plan's detection after a re-parse: the rooms changed, so unconfirmed finds and the claim go. */
export async function resetOpeningsDetection(db: SupabaseClient, planId: string): Promise<void> {
  await db.from("plan_openings").delete().eq("plan_id", planId).eq("source", "detected").is("confirmed_at", null);
  await db.from("plans").update({ openings_detected_at: null, openings_detection: null }).eq("id", planId);
}


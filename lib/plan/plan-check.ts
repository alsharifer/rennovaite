// =============================================================================
// lib/plan/plan-check.ts — the "Plan check" panel's facts (K5, R7 §3.8, Figma
// 24:814). PURE.
//
// Built on THE overlap detector (lib/plan/overlaps.ts findOverlaps — the same
// one the editor banner, the save record and the BoQ 409 use), so the panel
// can never disagree with the gate that blocks pricing. Adds what the panel
// prints: each pair's shared area (largest first), the share of all room area
// that is counted twice, and the plan's parsed total.
// =============================================================================

import { findOverlaps, sharedArea } from "./overlaps";
import { polygonArea } from "./polygon";

type Pt = [number, number];

export interface PlanCheckRoom {
  id: string;
  name: string;
  polygon: unknown;
}

export interface PlanCheckPair {
  aId: string;
  aName: string;
  bId: string;
  bName: string;
  /** Shared area in the polygons' own (normalised) units. */
  shared: number;
}

export interface PlanCheck {
  rooms: number;
  pairs: PlanCheckPair[];
  /** Overlapping area as a share of all room area — floor counted twice. 0..1. */
  share: number;
  roomIds: string[];
}

const asPoly = (p: unknown): Pt[] | null =>
  Array.isArray(p) && p.length >= 3 && p.every((v) => Array.isArray(v) && v.length >= 2 && v.every((n) => typeof n === "number" && Number.isFinite(n))) ? (p as Pt[]) : null;

export function planCheck(rooms: readonly PlanCheckRoom[]): PlanCheck {
  const report = findOverlaps(rooms.map((r) => ({ id: r.id, name: r.name, polygon: r.polygon })));
  const byId = new Map(rooms.map((r) => [r.id, asPoly(r.polygon)]));
  const pairs = report.pairs
    .map((p) => {
      const a = byId.get(p.a_id);
      const b = byId.get(p.b_id);
      const s = a && b ? sharedArea(a, b) : 0;
      return { aId: p.a_id, aName: p.a_name, bId: p.b_id, bName: p.b_name, shared: Number.isFinite(s) ? s : 0 };
    })
    .sort((x, y) => y.shared - x.shared);
  const total = rooms.reduce((n, r) => {
    const poly = asPoly(r.polygon);
    return n + (poly ? polygonArea(poly) : 0);
  }, 0);
  const twice = pairs.reduce((n, p) => n + p.shared, 0);
  return { rooms: rooms.length, pairs, share: total > 0 ? twice / total : 0, roomIds: report.room_ids };
}

/** "12 pairs of rooms overlap — 23.6% of the room area is counted twice (parser total 166.1 m²)." */
export function planCheckSentence(c: PlanCheck, totalAreaM2: number | null): string {
  const n = c.pairs.length;
  const pct = `${(Math.round(c.share * 1000) / 10).toFixed(1)}%`;
  const total = totalAreaM2 != null ? ` (parser total ${Math.round(totalAreaM2 * 10) / 10} m²)` : "";
  return `${n} pair${n === 1 ? "" : "s"} of rooms overlap — ${pct} of the room area is counted twice${total}. Pricing from this would overstate every area-based line.`;
}

// =============================================================================
// lib/plan/opening-anchor.ts — openings move with their wall (rule 2, 15 Oct).
// PURE.
//
// An opening is stored as a point. Before this, an outline edit moved the walls
// and left every opening where it was. On save (/api/update-plan) each opening
// is re-anchored: found on its edge of the OLD outline (its own room first),
// it moves to the same fraction along the corresponding edge of the NEW one.
//
// Two things make "the corresponding edge" more than "the same index":
//   - a save can re-fit the whole plan to the canvas (an outline dragged past
//     the old extent), so every stored point moves. The frame change is fitted
//     — one scale + offset, least squares over the rooms whose vertex count did
//     not change, rooms the user actually reshaped left out on a second pass —
//     and applied to anything that cannot be matched edge for edge;
//   - an edit can add or remove a corner, or a trim can renumber them. The edge
//     at the same index is used only when it is still parallel to the old one;
//     otherwise the parallel edge of the same room nearest the (re-framed)
//     opening takes it.
// An opening whose edge is gone stays at its re-framed point, off any wall:
// the plan rules then call it "Needs a wall" (lib/plan/plan-rules.ts) and it is
// left out of the BoQ and the renders until it is put back on one.
// =============================================================================

import { pointToSegment, type Pt } from "./polygon";
import { ON_WALL_TOL_M } from "./plan-rules";

export interface AnchorRoom { id: string; polygon: unknown }
export interface AnchorOpening { id: string; position: unknown; room_id?: string | null; context_id?: string | null; kind?: string | null }

export interface Reanchored {
  id: string;
  position: Pt;
  /** 0–1 along the edge it now sits on; null when it is off every wall. */
  t: number | null;
  /** Why it moved: its wall moved, the frame changed, or its wall is gone. */
  reason: "wall_moved" | "frame" | "wall_gone";
}

const asPoly = (p: unknown): Pt[] | null =>
  Array.isArray(p) && p.length >= 3 && p.every((q) => Array.isArray(q) && q.length >= 2 && Number.isFinite(q[0]) && Number.isFinite(q[1]))
    ? (p as number[][]).map(([x, y]) => [x!, y!] as Pt)
    : null;
const asPt = (p: unknown): Pt | null => (Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [Number(p[0]), Number(p[1])] : null);

export interface Frame { s: number; tx: number; ty: number }
const apply = (f: Frame, p: Pt): Pt => [f.s * p[0] + f.tx, f.s * p[1] + f.ty];

/** One scale + offset from old to new coordinates, over rooms that kept their corner count. */
export function fitFrame(oldRooms: readonly AnchorRoom[], newRooms: readonly AnchorRoom[]): Frame {
  const byId = new Map(newRooms.map((r) => [r.id, asPoly(r.polygon)]));
  let pairs: { id: string; p: Pt; q: Pt }[] = [];
  for (const r of oldRooms) {
    const a = asPoly(r.polygon), b = byId.get(r.id);
    if (a && b && a.length === b.length) a.forEach((p, i) => pairs.push({ id: r.id, p, q: b[i]! }));
  }
  const solve = (ps: typeof pairs): Frame => {
    if (ps.length === 0) return { s: 1, tx: 0, ty: 0 };
    const n = ps.length;
    const px = ps.reduce((s, x) => s + x.p[0], 0) / n, py = ps.reduce((s, x) => s + x.p[1], 0) / n;
    const qx = ps.reduce((s, x) => s + x.q[0], 0) / n, qy = ps.reduce((s, x) => s + x.q[1], 0) / n;
    let num = 0, den = 0;
    for (const { p, q } of ps) { num += (p[0] - px) * (q[0] - qx) + (p[1] - py) * (q[1] - qy); den += (p[0] - px) ** 2 + (p[1] - py) ** 2; }
    const s = den > 0 ? num / den : 1;
    return { s, tx: qx - s * px, ty: qy - s * py };
  };
  let f = solve(pairs);
  // Second pass: leave out the rooms that moved relative to the frame (the ones the user edited).
  const res = new Map<string, number>();
  for (const x of pairs) res.set(x.id, Math.max(res.get(x.id) ?? 0, Math.hypot(apply(f, x.p)[0] - x.q[0], apply(f, x.p)[1] - x.q[1])));
  const sorted = [...res.values()].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const keep = new Set([...res].filter(([, r]) => r <= Math.max(median * 3, 1e-6)).map(([id]) => id));
  if (keep.size > 0 && keep.size < res.size) {
    pairs = pairs.filter((x) => keep.has(x.id));
    f = solve(pairs);
  }
  return f;
}

interface Hit { roomId: string; i: number; t: number; a: Pt; b: Pt }

function hostEdge(p: Pt, rooms: readonly AnchorRoom[], prefer: string | null | undefined, tolUnits: number): Hit | null {
  let best: (Hit & { d: number }) | null = null;
  for (const r of rooms) {
    const poly = asPoly(r.polygon);
    if (!poly) continue;
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length]!;
      const { dist, t } = pointToSegment(p, a, b);
      if (dist > tolUnits) return;
      if (!best || dist < best.d - 1e-9 || (Math.abs(dist - best.d) <= 1e-9 && r.id === prefer)) best = { roomId: r.id, i, t, a, b, d: dist };
    });
  }
  return best;
}

const dir = (a: Pt, b: Pt) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l] as Pt; };
const parallel = (u: Pt, v: Pt, maxDeg: number) => Math.abs(u[0] * v[1] - u[1] * v[0]) <= Math.sin((maxDeg * Math.PI) / 180);

/**
 * Where each opening goes after an outline save. Only openings that move are
 * returned. `mPerUOld` is the OLD plan's metres per unit (for the on-wall
 * tolerance); gates in garden walls are not room openings and stay put.
 */
export function reanchorOpenings(oldRooms: readonly AnchorRoom[], newRooms: readonly AnchorRoom[], openings: readonly AnchorOpening[], mPerUOld: number): Reanchored[] {
  const frame = fitFrame(oldRooms, newRooms);
  const newById = new Map(newRooms.map((r) => [r.id, asPoly(r.polygon)]));
  const tol = ON_WALL_TOL_M / (mPerUOld > 0 ? mPerUOld : 1);
  const out: Reanchored[] = [];
  const moved = (id: string, from: Pt, to: Pt, t: number | null, reason: Reanchored["reason"]) => {
    if (Math.hypot(to[0] - from[0], to[1] - from[1]) > 1e-6) out.push({ id, position: to, t, reason });
  };
  for (const o of openings) {
    if (o.context_id || o.kind === "gate") continue;
    const p = asPt(o.position);
    if (!p) continue;
    const framed = apply(frame, p);
    const hit = hostEdge(p, oldRooms, o.room_id, tol);
    if (!hit) { moved(o.id, p, framed, null, "frame"); continue; } // off every wall before the edit: keep it with the frame
    const poly = newById.get(hit.roomId);
    if (!poly) { moved(o.id, p, framed, null, "wall_gone"); continue; }
    const oldDir = dir(hit.a, hit.b);
    const same = poly.length === asPoly(oldRooms.find((r) => r.id === hit.roomId)!.polygon)!.length ? { a: poly[hit.i]!, b: poly[(hit.i + 1) % poly.length]! } : null;
    let edge: { a: Pt; b: Pt; t: number } | null = null;
    if (same && parallel(dir(same.a, same.b), oldDir, 20)) edge = { ...same, t: hit.t };
    else {
      // The parallel edge of the same room nearest the re-framed point takes it.
      let best: { a: Pt; b: Pt; t: number; d: number } | null = null;
      poly.forEach((a, i) => {
        const b = poly[(i + 1) % poly.length]!;
        if (!parallel(dir(a, b), oldDir, 10)) return;
        const { dist, t } = pointToSegment(framed, a, b);
        if (!best || dist < best.d) best = { a, b, t, d: dist };
      });
      const reach = (0.5 / (mPerUOld > 0 ? mPerUOld : 1)) * Math.abs(frame.s) + tol;
      if (best && (best as { d: number }).d <= reach) edge = best;
    }
    if (!edge) { moved(o.id, p, framed, null, "wall_gone"); continue; }
    const to: Pt = [edge.a[0] + (edge.b[0] - edge.a[0]) * edge.t, edge.a[1] + (edge.b[1] - edge.a[1]) * edge.t];
    moved(o.id, p, to, edge.t, Math.hypot(to[0] - framed[0], to[1] - framed[1]) > 1e-6 ? "wall_moved" : "frame");
  }
  return out;
}

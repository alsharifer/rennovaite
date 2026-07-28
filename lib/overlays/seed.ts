// =============================================================================
// lib/overlays/seed.ts — rule-based overlay seeding (Prompt P2).
//
// seedOverlays(planGraph) applies the DEFAULT rules (lib/overlays/rules.ts) to
// place electrical + plumbing fixtures per room. Pure + deterministic (same
// graph → identical fixtures), so it is unit-tested against the rules table.
// Positions are in NORMALISED plan space (recovered from the graph's metric
// rooms) so they stay stable if the plan's metric scale later changes.
// Every seeded fixture carries source: 'rule'.
// =============================================================================

import type { PlanGraph, Point } from "@/lib/plan/geometry";

import { ROOM_RULES, roomCategory, ruleCount } from "./rules";
import { layerOf, type SeededFixture } from "./types";

interface Bbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** metric point → normalised plan space (inverse of buildPlanGraph's mapping). */
function toNorm(p: Point, graph: PlanGraph): [number, number] {
  const u = graph.meta.unit_to_m || 1;
  const [ox, oy] = graph.meta.norm_origin;
  return [ox + p[0] / u, oy + p[1] / u];
}

function bboxOf(pts: [number, number][]): Bbox {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function inset(b: Bbox, f = 0.12): Bbox {
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  return {
    minX: b.minX + w * f,
    minY: b.minY + h * f,
    maxX: b.maxX - w * f,
    maxY: b.maxY - h * f,
  };
}

/** Deterministic point at fraction t∈[0,1) around a rectangle's perimeter. */
function perimeterPoint(b: Bbox, t: number): [number, number] {
  const w = Math.max(b.maxX - b.minX, 1e-6);
  const h = Math.max(b.maxY - b.minY, 1e-6);
  const per = 2 * (w + h);
  let d = (t - Math.floor(t)) * per;
  if (d < w) return [b.minX + d, b.minY];
  d -= w;
  if (d < h) return [b.maxX, b.minY + d];
  d -= h;
  if (d < w) return [b.maxX - d, b.maxY];
  d -= w;
  return [b.minX, b.maxY - d];
}

export interface SeedOptions {
  /** Chosen style key (lib/styles) — reserved for future style-driven density. */
  styleKey?: string | null;
}

/**
 * Seed the default electrical + plumbing fixtures for a plan. Positions are
 * spread around each room's inset perimeter (where sockets/switches live),
 * purely for a readable PoC layout — the BoQ uses counts, not positions.
 */
export function seedOverlays(
  graph: PlanGraph,
  _opts: SeedOptions = {},
): SeededFixture[] {
  void _opts; // style-driven density is a future refinement
  const fixtures: SeededFixture[] = [];

  for (const room of graph.rooms) {
    const rules = ROOM_RULES[roomCategory(room.type)];
    if (!rules.length) continue;

    // Expand rules → a flat list of (type) for this room.
    const flat: SeededFixture["type"][] = [];
    for (const rule of rules) {
      const n = ruleCount(rule, room.area_m2);
      for (let i = 0; i < n; i++) flat.push(rule.type);
    }
    if (!flat.length) continue;

    const normPoly = room.polygon.map((p) => toNorm(p, graph));
    const ring = inset(bboxOf(normPoly));

    flat.forEach((type, k) => {
      const pos = perimeterPoint(ring, (k + 0.5) / flat.length);
      fixtures.push({
        layer: layerOf(type),
        type,
        room_id: room.id,
        position: [Math.round(pos[0] * 1e4) / 1e4, Math.round(pos[1] * 1e4) / 1e4],
        wall_id: null,
        spec: null,
        source: "rule",
      });
    });
  }

  return fixtures;
}

/** Count fixtures by type (used by the BoQ feed + verification). */
export function countByType(
  fixtures: { type: SeededFixture["type"] }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of fixtures) out[f.type] = (out[f.type] ?? 0) + 1;
  return out;
}

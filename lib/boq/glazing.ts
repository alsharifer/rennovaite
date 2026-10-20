// =============================================================================
// lib/boq/glazing.ts — aluminium & glazing from the plan's OWN openings (C1).
//
// Until C1 the "Aluminum & Glass" section was the reference villa's aluminium
// order printed line by line — its rooms ("Guest bedroom", "Office"), its
// quantities and its totals — on every project with an interior room
// (docs/SPRINT_C_ROOT_CAUSE.md §1). The order now enters the engine only as two
// rates per m² of opening (R-75 window, R-76 external door, lib/boq/rules.ts),
// and the quantities come from this plan:
//
//   window          every window on a wall of a roofed room in this renovation
//   external door   a door between a roofed room and the outside — no room, a
//                   terrace / balcony, or an open zone (a lawn, paving)
//
// Internal doors are joinery (GT/joinery door leaf + frame), archways have no
// glazing, a garden gate is the garden's. An opening the plan rules left off a
// wall ("Needs a wall") or a detected one not yet confirmed never reaches the
// graph the take-off reads, so it is never priced. A size that was defaulted or
// detected, not measured, makes the line's quantity derived.
//
// No openings drawn → no glazing lines, and the BoQ carries the reason the
// Issues navigator shows (NO_GLAZING_REASON). There is no fallback allowance
// (ruled 20 Oct).
//
// Pure: no I/O. The lines are priced by the caller through the rate resolver
// (lib/boq/assemble.ts), so a firm's own window rate answers first.
// =============================================================================

import type { Opening, PlanGraph } from "@/lib/plan/geometry";
import { placeOpening } from "@/lib/plan/plan-rules";

import { LANDSCAPE_TYPES } from "./rules";
import type { PomiSection, ScopeItem } from "./schema";

export const NO_GLAZING_REASON = "No windows or doors drawn — glazing not priced.";
export const GLAZING_UNREADABLE_REASON = "The plan's windows and doors could not be read — glazing not priced.";

export const GLAZING_ITEM_KEYS = { window: "alum.window", external_door: "alum.external_door" } as const;

/** Interior room types that are outdoors in all but name — a door onto one is an external door. */
const OUTSIDE_ROOM_TYPES = new Set(["terrace", "balcony"]);

export type GlazingKind = keyof typeof GLAZING_ITEM_KEYS;

export interface GlazingOpening {
  id: string;
  kind: GlazingKind;
  /** This plan's room(s) the opening belongs to — never another project's. */
  rooms: string[];
  width_mm: number;
  height_mm: number;
  area_m2: number;
  /** The size was defaulted or detected, not measured. */
  derived: boolean;
}

/** A scope item for the resolver, plus the openings it counts (its element refs). */
export type GlazingScopeItem = ScopeItem & { element_refs: string[] };

const round2 = (n: number) => Math.round(n * 100) / 100;
const metres = (mm: number) => (mm / 1000).toFixed(2);

/**
 * The windows and external doors on this plan that the renovation touches.
 * `inScope` (K12): the ids of the rooms in this renovation — an opening counts
 * when a roofed room beside it is in scope. Omitted = every room.
 */
export function glazingOpeningsFrom(graph: PlanGraph, inScope?: ReadonlySet<string>): GlazingOpening[] {
  const rooms = new Map(graph.rooms.map((r) => [r.id, r]));
  const walls = new Map(graph.walls.map((w) => [w.id, w]));
  const isRoofedInterior = (id: string | null) => {
    const r = id ? rooms.get(id) : undefined;
    return !!r && !r.unroofed && !OUTSIDE_ROOM_TYPES.has(r.type ?? "");
  };
  // What is on each side of an opening is probed 0.3 m out from the edge it sits
  // on (the plan rules' placeOpening) — not read from the derived wall's
  // room_ids: hand-drawn neighbours rarely share an edge exactly, so a wall
  // between two rooms often derives as two one-room walls and an internal door
  // would read as external. The graph is metric, so one unit is one metre.
  const ruleRooms = graph.rooms.map((r) => ({ id: r.id, room_type: r.type, unroofed: r.unroofed, polygon: r.polygon }));
  const sidesOf = (o: Opening): (string | null)[] => {
    const pl = o.position ? placeOpening({ id: o.id, kind: o.type, width_mm: o.width_mm, position: o.position, room_id: o.room_id }, ruleRooms, 1) : null;
    if (pl) return pl.sides;
    const wall = o.wall_id ? walls.get(o.wall_id) : undefined;
    return wall ? [wall.room_ids[0] ?? null, wall.room_ids[1] ?? null] : [];
  };
  const out: GlazingOpening[] = [];
  for (const o of graph.openings ?? []) {
    if (o.type !== "window" && o.type !== "door") continue;
    if (o.unconfirmed || o.context_id || !o.wall_id) continue;
    const sides = sidesOf(o);
    if (sides.length === 0) continue;
    const inside = [...new Set(sides.filter(isRoofedInterior) as string[])];
    if (inside.length === 0) continue;
    if (inScope && !inside.some((id) => inScope.has(id))) continue;
    let kind: GlazingKind;
    if (o.type === "window") kind = "window";
    else {
      // A door with a roofed room on BOTH sides is an internal door (joinery).
      if (sides.every(isRoofedInterior) && inside.length === 2) continue;
      kind = "external_door";
    }
    const area = (o.width_mm * o.height_mm) / 1_000_000;
    if (!(area > 0)) continue;
    out.push({
      id: o.id,
      kind,
      rooms: inside.map((id) => rooms.get(id)!.name_en).filter((n): n is string => !!n),
      width_mm: o.width_mm,
      height_mm: o.height_mm,
      area_m2: area,
      derived: o.derived === true || o.dims_derived === true,
    });
  }
  return out;
}

const SCOPE: Record<GlazingKind, { rule_id: string; description: string; mark: string }> = {
  window: { rule_id: "Q-38", description: "Aluminium windows — thermal-break, double-glazed, supply and install", mark: "W" },
  external_door: { rule_id: "Q-39", description: "Aluminium external doors — thermal-break, double-glazed, supply and install", mark: "D" },
};

/** One scope item per kind with at least one opening: m² of opening, each opening named by its own room. */
export function glazingScope(openings: readonly GlazingOpening[]): GlazingScopeItem[] {
  const items: GlazingScopeItem[] = [];
  for (const kind of ["window", "external_door"] as const) {
    const these = openings.filter((o) => o.kind === kind);
    if (these.length === 0) continue;
    const s = SCOPE[kind];
    const qty = round2(these.reduce((sum, o) => sum + o.area_m2, 0));
    const parts = these.map(
      (o, i) => `${s.mark}${i + 1} ${o.rooms.join(" / ") || "room"} ${metres(o.width_mm)} × ${metres(o.height_mm)} m = ${round2(o.area_m2).toFixed(2)} m²${o.derived ? " (size not measured)" : ""}`,
    );
    items.push({
      rule_id: s.rule_id,
      work_section: "Aluminum & Glass" as PomiSection,
      item_key: GLAZING_ITEM_KEYS[kind],
      description: s.description,
      quantity: qty,
      unit: "m2",
      measurement: `Σ ${these.length} opening${these.length === 1 ? "" : "s"} on the plan: ${parts.join("; ")}`,
      ...(these.some((o) => o.derived) ? { qty_derived: true } : {}),
      element_refs: these.map((o) => o.id),
    });
  }
  return items;
}

/** Whether the plan has a roofed interior room at all — only then is missing glazing a gap worth naming. */
export function hasRoofedInterior(rooms: readonly { room_type: string | null; unroofed?: boolean | null }[]): boolean {
  return rooms.some((r) => !r.unroofed && !OUTSIDE_ROOM_TYPES.has(r.room_type ?? "") && !LANDSCAPE_TYPES.has(r.room_type ?? ""));
}

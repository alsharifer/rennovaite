// =============================================================================
// lib/plan/wet-room-setup.ts — the wet-room panel's state (bathroom pilot B7 4).
// Pure: what the panel shows, read from where it is stored, and what a change
// writes. The pilot set every one of these by script; the panel on 01 Plan sets
// them now, and the wet-room package (lib/boq/wet-room.ts) and the room's
// drawings read the same places:
//
//   bulkhead     rooms.spec.bulkhead = { over } | false
//   extractor    rooms.spec.extractor (false = none; absent = yes)
//   heater       a `water_heater` plumbing fixture on its wall — spec.height_mm
//                (mounted height, bottom of the tank), spec.action box_in | relocate
//   niche        the shower fixture's spec.niche_wall / niche_width_mm /
//                niche_height_mm (spec.niche = "none" = no niche)
//   valve wall   the shower fixture's spec.column_wall
// =============================================================================

export type Wall = "N" | "E" | "S" | "W";
export const WALLS: readonly Wall[] = ["N", "E", "S", "W"];
export type BulkheadOver = "shower" | "bath" | "vanity" | "wc";

export interface WetRoomSetup {
  bulkhead: { over: BulkheadOver } | null;
  heater: { wall: Wall; height_mm: number; action: "box_in" | "relocate" } | null;
  niche: { wall: Wall; width_mm: number; height_mm: number } | null;
  valve_wall: Wall | null;
  extractor: boolean;
}

export const NICHE_DEFAULT = { width_mm: 600, height_mm: 300 } as const;
export const HEATER_DEFAULT_HEIGHT_MM = 2100;

type Fx = { id: string; type: string; position: [number, number]; spec: Record<string, unknown> | null };
const asWall = (v: unknown): Wall | null => (typeof v === "string" && (WALLS as readonly string[]).includes(v.toUpperCase()[0] ?? "") ? (v.toUpperCase()[0] as Wall) : null);
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : d);

/** The nearest wall of a rectangle-ish room polygon to a point (plan up = N). */
export function wallOfPoint(p: readonly [number, number], polygon: readonly (readonly [number, number])[]): Wall {
  const xs = polygon.map((q) => q[0]), ys = polygon.map((q) => q[1]);
  const d: Record<Wall, number> = { N: Math.abs(p[1] - Math.min(...ys)), S: Math.abs(Math.max(...ys) - p[1]), W: Math.abs(p[0] - Math.min(...xs)), E: Math.abs(Math.max(...xs) - p[0]) };
  return (Object.entries(d) as [Wall, number][]).sort((a, b) => a[1] - b[1])[0]![0];
}

/** Where a fixture on a wall goes: the middle of that wall, just inside the room. */
export function pointOnWall(wall: Wall, polygon: readonly (readonly [number, number])[], inset = 0.01): [number, number] {
  const xs = polygon.map((q) => q[0]), ys = polygon.map((q) => q[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return wall === "N" ? [cx, y0 + inset] : wall === "S" ? [cx, y1 - inset] : wall === "W" ? [x0 + inset, cy] : [x1 - inset, cy];
}

export function setupOf(roomSpec: Record<string, unknown> | null | undefined, fixtures: readonly Fx[], polygon: readonly (readonly [number, number])[]): WetRoomSetup {
  const b = roomSpec?.bulkhead;
  const shower = fixtures.find((f) => f.type === "shower_mixer") ?? null;
  const heater = fixtures.find((f) => f.type === "water_heater") ?? null;
  const ss = shower?.spec ?? {};
  return {
    bulkhead: b && typeof b === "object" ? { over: (["shower", "bath", "vanity", "wc"] as const).find((o) => o === (b as Record<string, unknown>).over) ?? "shower" } : b === true ? { over: "shower" } : null,
    heater: heater ? { wall: wallOfPoint(heater.position, polygon), height_mm: num(heater.spec?.height_mm, HEATER_DEFAULT_HEIGHT_MM), action: heater.spec?.action === "relocate" ? "relocate" : "box_in" } : null,
    niche: !shower || ss.niche === "none" ? null : { wall: asWall(ss.niche_wall) ?? "N", width_mm: num(ss.niche_width_mm, NICHE_DEFAULT.width_mm), height_mm: num(ss.niche_height_mm, NICHE_DEFAULT.height_mm) },
    valve_wall: shower ? asWall(ss.column_wall) : null,
    extractor: roomSpec?.extractor !== false,
  };
}

export interface SetupWrites {
  roomSpec: Record<string, unknown>;
  /** The shower fixture's new spec (null = no shower in the room). */
  showerSpec: { id: string; spec: Record<string, unknown> } | null;
  heater: { op: "none" } | { op: "delete"; id: string } | { op: "upsert"; id: string | null; position: [number, number]; spec: Record<string, unknown> };
}

/** What a setup writes, given what is stored now. */
export function writesFor(setup: WetRoomSetup, roomSpec: Record<string, unknown> | null | undefined, fixtures: readonly Fx[], polygon: readonly (readonly [number, number])[]): SetupWrites {
  const spec = { ...(roomSpec ?? {}) };
  spec.bulkhead = setup.bulkhead ? { over: setup.bulkhead.over } : false;
  if (setup.extractor) delete spec.extractor;
  else spec.extractor = false;

  const shower = fixtures.find((f) => f.type === "shower_mixer") ?? null;
  let showerSpec: SetupWrites["showerSpec"] = null;
  if (shower) {
    const s = { ...(shower.spec ?? {}) };
    if (setup.valve_wall) s.column_wall = setup.valve_wall;
    else delete s.column_wall;
    if (setup.niche) Object.assign(s, { niche: "yes", niche_wall: setup.niche.wall, niche_width_mm: setup.niche.width_mm, niche_height_mm: setup.niche.height_mm });
    else Object.assign(s, { niche: "none" });
    showerSpec = { id: shower.id, spec: s };
  }

  const heater = fixtures.find((f) => f.type === "water_heater") ?? null;
  let h: SetupWrites["heater"] = { op: "none" };
  if (!setup.heater && heater) h = { op: "delete", id: heater.id };
  else if (setup.heater) {
    const sameWall = heater && wallOfPoint(heater.position, polygon) === setup.heater.wall;
    h = {
      op: "upsert",
      id: heater?.id ?? null,
      // Kept where it is when it stays on its wall; else the middle of the new one.
      position: sameWall ? heater!.position : pointOnWall(setup.heater.wall, polygon),
      spec: { ...(heater?.spec ?? {}), height_mm: setup.heater.height_mm, action: setup.heater.action },
    };
  }
  return { roomSpec: spec, showerSpec, heater: h };
}

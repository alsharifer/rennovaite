// =============================================================================
// lib/boq/scope-components.ts — count rules for the components Newspace's
// scoping left out (S6-pre, Delta Log column G).
//
// Pure functions over a minimal room shape, so every formula is unit-testable
// without a plan graph, a database, or an engine run. Each returns its own
// `measurement` string in the same style as F-xx, because a quantity a QS
// cannot re-derive by hand is a quantity they will not sign.
//
// EVERY rate produced downstream from these counts is `indicative` and
// pending-review. None of them is a Villa 94 transaction: the whole point of
// column G is that these components were never quoted, so there is no actual to
// anchor to. Where a rate is a judgement call it says so, with the reasoning,
// and Friday's QS column overrides it.
//
// Read alongside lib/boq/component-dedupe.ts — a count here means nothing if
// another section is already counting the same physical thing.
// =============================================================================

export interface ComponentRoom {
  id: string;
  /** DB room type (bedroom, master_bedroom, bathroom, living, …). */
  type: string | null;
  area_m2: number;
}

export interface ComponentCount {
  quantity: number;
  unit: string;
  /** Hand-checkable derivation, in the F-xx house style. */
  measurement: string;
  /**
   * true = the quantity rests on a chosen divisor or convention rather than a
   * measured value. Surfaced in the UI so nobody reads it as surveyed.
   */
  derived: boolean;
}

// --- room classification -----------------------------------------------------
// Deliberately duplicated from quantify.ts rather than imported: that set
// defines what gets WET TILING priced, and silently inheriting a change there
// into water-heater counts would be a bug nobody would look for.
const WET_TYPES = new Set(["bathroom", "ensuite", "powder", "kitchen"]);
const EXTERIOR_TYPES = new Set(["balcony", "terrace", "garden", "yard", "parking", "garage"]);
const CIRCULATION_TYPES = new Set(["stairs", "foyer", "corridor", "passage", "shaft", "void"]);
const SLEEPING_TYPES = new Set(["bedroom", "master_bedroom", "kids_bedroom", "guest_bedroom"]);
/** Rooms that get a decorative LED cove: the ones people sit in, plus master. */
const LED_STRIP_TYPES = new Set(["living", "dining", "majlis", "master_bedroom"]);

export const isWet = (t: string | null) => WET_TYPES.has(t ?? "");
export const isExterior = (t: string | null) => EXTERIOR_TYPES.has(t ?? "");
export const isCirculation = (t: string | null) => CIRCULATION_TYPES.has(t ?? "");
export const isSleeping = (t: string | null) => SLEEPING_TYPES.has(t ?? "");
export const isInterior = (t: string | null) => !isExterior(t);

// --- G10a: ceiling spotlights ------------------------------------------------

/**
 * Ceiling spotlight divisor, m² of floor per fitting.
 *
 * CHOSEN VALUE: 3.5 m². It is the existing F-06 constant
 * (AREA_PER_DOWNLIGHT_M2), kept deliberately rather than re-picked, because
 * Villa 94's own ceiling layout calibrated it and inventing a second divisor
 * for the same physical fitting would put two different spotlight densities in
 * one product. One fitting per 3.5 m² is a normal Dubai residential density for
 * 2.9 m ceilings.
 *
 * ALWAYS `derived`: no drawing has been counted. A reflected ceiling plan
 * replaces this, and until one exists the number is a defensible guess.
 */
export const SPOTLIGHT_AREA_DIVISOR_M2 = 3.5;

export function spotlightCount(rooms: ComponentRoom[]): ComponentCount {
  const interior = rooms.filter((r) => isInterior(r.type));
  const quantity = interior.reduce(
    (s, r) => s + Math.ceil(r.area_m2 / SPOTLIGHT_AREA_DIVISOR_M2),
    0,
  );
  return {
    quantity,
    unit: "no",
    measurement: `S6-01: Σ interior ceil(area / ${SPOTLIGHT_AREA_DIVISOR_M2} m²) over ${interior.length} rooms = ${quantity}`,
    derived: true,
  };
}

// --- G10b: LED strip -------------------------------------------------------

/**
 * Cove LED strip runs at the room PERIMETER, but the plan graph reaching the
 * engine carries area, not perimeter, so the run is estimated from area
 * assuming a rectangle of aspect C-05 (1.3). For area A and aspect k the
 * perimeter is 2(√(Ak) + √(A/k)).
 *
 * Living/dining/master only — a cove in a bathroom or a corridor is not what
 * anyone means by this line, and pricing one everywhere would inflate a
 * component nobody asked for.
 */
export const LED_STRIP_ASPECT = 1.3;

export function ledStripAllowance(rooms: ComponentRoom[]): ComponentCount {
  const eligible = rooms.filter((r) => LED_STRIP_TYPES.has(r.type ?? ""));
  const lm = eligible.reduce((s, r) => {
    const w = Math.sqrt(r.area_m2 * LED_STRIP_ASPECT);
    const d = Math.sqrt(r.area_m2 / LED_STRIP_ASPECT);
    return s + 2 * (w + d);
  }, 0);
  const quantity = Math.round(lm * 100) / 100;
  return {
    quantity,
    unit: "lm",
    measurement:
      `S6-02: Σ perimeter over ${eligible.length} eligible room(s) ` +
      `(living/dining/majlis/master only), perimeter from area at aspect ${LED_STRIP_ASPECT} = ${quantity} lm`,
    derived: true,
  };
}

// --- G12: water heaters ------------------------------------------------------

/**
 * CONVENTION: one heater per WET-ROOM CLUSTER, and each wet room is its own
 * cluster unless a real riser layout says otherwise.
 *
 * That reduces to one per wet room here, which is what R-17 already assumes
 * (1 per bathroom). It is stated as a cluster rule rather than a per-room rule
 * because the moment a plan has an ensuite sharing a wall and a riser with a
 * main bath, the honest count is one heater, not two — and the rule should
 * already say so rather than be quietly rewritten later.
 *
 * Kitchens are excluded: a kitchen sink runs off the same heater as the nearest
 * bathroom in a villa of this size, and counting one per kitchen would add a
 * heater nobody installs.
 */
export function waterHeaterCount(rooms: ComponentRoom[]): ComponentCount {
  const clusters = rooms.filter((r) => isWet(r.type) && r.type !== "kitchen");
  return {
    quantity: clusters.length,
    unit: "no",
    measurement: `S6-03: 1 per wet-room cluster (kitchens excluded) = ${clusters.length}`,
    derived: true,
  };
}

// --- G13: sockets and switches ----------------------------------------------

/**
 * Sockets scale with area and room type; switches are per room with two-way
 * pairs where a room has two entrances.
 *
 * SOCKETS: base count by type, plus one per whole `SOCKET_AREA_STEP_M2` above
 * the type's base area. Bedrooms and living rooms accumulate sockets with size;
 * wet rooms and circulation do not (a bigger bathroom does not want more
 * sockets, it wants the same shaver point).
 *
 * SWITCHES: one per room, PLUS a second for two-way switching in rooms with two
 * entrances — stairs (top and bottom) and bedrooms (door and bedside), which is
 * the convention the brief names.
 *
 * This is deliberately more explicit than F-07's blended `ceil(area × 0.4)`,
 * which produces one undifferentiated "points" number. F-07 stays as-is and
 * keeps owning the Electrical section line; these counts exist so the catalog
 * can price sockets and switches as separate spec-class choices. They MUST NOT
 * both reach the BoQ — see component-dedupe.ts.
 */
export const SOCKET_AREA_STEP_M2 = 6;

const SOCKET_BASE: Record<string, { base: number; scales: boolean }> = {
  master_bedroom: { base: 4, scales: true },
  bedroom: { base: 3, scales: true },
  kids_bedroom: { base: 3, scales: true },
  guest_bedroom: { base: 3, scales: true },
  living: { base: 4, scales: true },
  majlis: { base: 4, scales: true },
  dining: { base: 2, scales: true },
  kitchen: { base: 6, scales: true },
  bathroom: { base: 1, scales: false },
  ensuite: { base: 1, scales: false },
  powder: { base: 1, scales: false },
  closet: { base: 1, scales: false },
  foyer: { base: 1, scales: false },
  passage: { base: 1, scales: false },
  stairs: { base: 1, scales: false },
};

export interface SocketSwitchCounts {
  sockets: ComponentCount;
  switches: ComponentCount;
}

export function socketSwitchCounts(rooms: ComponentRoom[]): SocketSwitchCounts {
  const interior = rooms.filter((r) => isInterior(r.type));

  let sockets = 0;
  for (const r of interior) {
    const spec = SOCKET_BASE[r.type ?? ""] ?? { base: 2, scales: true };
    sockets += spec.base;
    if (spec.scales) sockets += Math.floor(r.area_m2 / SOCKET_AREA_STEP_M2);
  }

  let switches = 0;
  let twoWay = 0;
  for (const r of interior) {
    switches += 1;
    if (r.type === "stairs" || isSleeping(r.type)) {
      switches += 1;
      twoWay += 1;
    }
  }

  return {
    sockets: {
      quantity: sockets,
      unit: "no",
      measurement:
        `S6-04a: Σ interior (type base + floor(area / ${SOCKET_AREA_STEP_M2} m²) where the type scales) = ${sockets}`,
      derived: true,
    },
    switches: {
      quantity: switches,
      unit: "no",
      measurement:
        `S6-04b: 1 per interior room (${interior.length}) + 1 two-way for stairs and bedrooms (${twoWay}) = ${switches}`,
      derived: true,
    },
  };
}

// --- G19: vanity stone slabs -------------------------------------------------

/**
 * One slab per vanity unit wherever the joinery scope includes a vanity.
 *
 * Driven by the JOINERY count, not the room count: a bathroom without a vanity
 * in the joinery package does not get a slab, and that is the distinction G19
 * is actually making. Dimensions are unknown, so the line is an allowance and
 * must carry `site_assessment` — folding it into tile area would bury it inside
 * a QS-validated rate.
 */
export function vanitySlabCount(vanityUnits: number): ComponentCount {
  const quantity = Math.max(0, Math.floor(vanityUnits));
  return {
    quantity,
    unit: "no",
    measurement: `S6-05: 1 slab per vanity unit in the joinery scope = ${quantity}`,
    derived: true,
  };
}

// --- G21: shower glass + mirrors --------------------------------------------

/**
 * Shower glass partition per wet room WITH A SHOWER, mirror per vanity.
 *
 * A powder room has no shower, so it gets a mirror and no glass — which is why
 * these are two counts and not one "per bathroom" number.
 */
export function showerGlassCount(rooms: ComponentRoom[]): ComponentCount {
  const showers = rooms.filter((r) => r.type === "bathroom" || r.type === "ensuite");
  return {
    quantity: showers.length,
    unit: "no",
    measurement: `S6-06: 1 per wet room with a shower (bathroom/ensuite; powder excluded) = ${showers.length}`,
    derived: true,
  };
}

export function mirrorCount(rooms: ComponentRoom[], vanityUnits: number): ComponentCount {
  // Every wet room gets a mirror; if the joinery package carries MORE vanities
  // than there are wet rooms, the extra vanities get mirrors too.
  const wet = rooms.filter((r) => isWet(r.type) && r.type !== "kitchen").length;
  const quantity = Math.max(wet, Math.max(0, Math.floor(vanityUnits)));
  return {
    quantity,
    unit: "no",
    measurement: `S6-07: max(wet rooms ${wet}, vanity units ${Math.max(0, Math.floor(vanityUnits))}) = ${quantity}`,
    derived: true,
  };
}

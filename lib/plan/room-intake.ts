// =============================================================================
// lib/plan/room-intake.ts — "One room from its dimensions" (bathroom pilot B1).
//
// A client with a tape measure and no drawing gives L × W × H; the project
// starts with ONE rectangular room. Pure, so the intake form, the route and the
// tests read one definition.
//
// The room is an AUTHORED plan whose plot is the room itself: normalised x runs
// 0 → 1 across the length, y 0 → W / L (the plan's isotropic unit, as every
// authored plan), so `plans.plot_width_m` = L is a measured metre scale and the
// polygon, the area and the height are all measured — nothing here is derived.
// Nothing in it is bathroom-specific: any single room starts this way.
// =============================================================================

import type { DEFAULT_OPENING_DIMS } from "./geometry";

/** Room types the intake offers (DB tokens), with the name a new room gets. */
export const ROOM_INTAKE_TYPES = ["bathroom", "ensuite", "powder", "kitchen", "bedroom", "living", "other"] as const;
export type RoomIntakeType = (typeof ROOM_INTAKE_TYPES)[number];

export const ROOM_INTAKE_LABEL: Record<RoomIntakeType, string> = {
  bathroom: "Bathroom",
  ensuite: "Ensuite",
  powder: "Powder room",
  kitchen: "Kitchen",
  bedroom: "Bedroom",
  living: "Living room",
  // Not "Room": the plan rules read that as unnamed (rule 10) and would block pricing.
  other: "Other room",
};

/** The intake's own bounds (metres) — the route's zod schema states the same. */
export const ROOM_INTAKE_BOUNDS = { side: [0.5, 30] as const, height: [1.8, 6] as const };

/** Entered to 2 dp — the form's precision is the stored precision. */
export const to2dp = (n: number) => Math.round(n * 100) / 100;

export interface IntakeRoom {
  room_type: RoomIntakeType;
  name_en: string;
  length_m: number;
  width_m: number;
  /** L × W, 2 dp. */
  area_m2: number;
  ceiling_h_m: number;
  /** Normalised polygon, clockwise from the top-left (NW) corner. */
  polygon: [number, number][];
}

/** The one room the intake creates. */
export function roomFromDimensions(input: { room_type: RoomIntakeType; length_m: number; width_m: number; height_m: number; name?: string | null }): IntakeRoom {
  const L = to2dp(input.length_m);
  const W = to2dp(input.width_m);
  const H = to2dp(input.height_m);
  const depth = W / L;
  return {
    room_type: input.room_type,
    name_en: input.name?.trim() || ROOM_INTAKE_LABEL[input.room_type],
    length_m: L,
    width_m: W,
    area_m2: to2dp(L * W),
    ceiling_h_m: H,
    polygon: [
      [0, 0],
      [1, 0],
      [1, depth],
      [0, depth],
    ],
  };
}

export interface IntakeDraft {
  length: string;
  width: string;
  height: string;
}

/** Parse the form, or the reason Continue is disabled. */
export function parseIntakeDraft(d: IntakeDraft): { ok: true; length_m: number; width_m: number; height_m: number } | { ok: false; reason: string } {
  const vals = [d.length, d.width, d.height].map((s) => (s.trim() === "" ? NaN : Number(s)));
  const [L, W, H] = vals as [number, number, number];
  if (![L, W, H].every(Number.isFinite)) return { ok: false, reason: "Enter the room's length, width and height in metres" };
  const [sMin, sMax] = ROOM_INTAKE_BOUNDS.side;
  const [hMin, hMax] = ROOM_INTAKE_BOUNDS.height;
  if (L < sMin || L > sMax || W < sMin || W > sMax) return { ok: false, reason: `Length and width are ${sMin}–${sMax} m` };
  if (H < hMin || H > hMax) return { ok: false, reason: `Ceiling height is ${hMin}–${hMax} m` };
  return { ok: true, length_m: to2dp(L), width_m: to2dp(W), height_m: to2dp(H) };
}

/**
 * The size a door or window starts at on a room-from-dimensions plan — a single
 * room's door is a 0.8 m leaf and its window a small, high one (0.6 × 1.2 m on
 * a 1.2 m sill). Defaults stay DERIVED until both dimensions are entered (A5).
 * Every other plan keeps DEFAULT_OPENING_DIMS.
 */
export const ROOM_INTAKE_OPENING_DIMS: Pick<typeof DEFAULT_OPENING_DIMS, "door" | "window"> = {
  door: { width_mm: 800, height_mm: 2100, sill_mm: 0 },
  window: { width_mm: 600, height_mm: 1200, sill_mm: 1200 },
};

/** The default size for an opening kind on a plan of this intake. */
export function openingDefaultsFor<K extends keyof typeof DEFAULT_OPENING_DIMS>(all: typeof DEFAULT_OPENING_DIMS, kind: K, intake: string | null | undefined): (typeof DEFAULT_OPENING_DIMS)[K] {
  if (intake === "room_dimensions" && (kind === "door" || kind === "window")) return ROOM_INTAKE_OPENING_DIMS[kind as "door" | "window"];
  return all[kind];
}

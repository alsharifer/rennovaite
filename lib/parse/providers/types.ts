// =============================================================================
// lib/parse/providers/types.ts — the parse provider contract.
//
// A provider turns a plan asset (PDF/image) into a raw, normalised room parse
// with a per-room confidence. The rest of the pipeline (overlap repair →
// buildPlanGraph) is provider-agnostic, so NOTHING downstream depends on which
// provider produced a PlanGraph. The in-house Claude-vision parser is the
// default; a hosted raster→vector adapter is S4b.
// =============================================================================

export type ParseAsset =
  | { kind: "pdf"; data: string }
  | { kind: "image"; data: string; mediaType: "image/png" | "image/jpeg" };

export interface RawParsedRoom {
  id: string;
  name_en: string;
  name_ar: string | null;
  room_type: string;
  area_m2: number;
  /** Normalised [0,1] polygon following the real walls; N-vertex, may be
   *  diagonal. Not a bounding box. */
  polygon: [number, number][];
  /** Provider's self-reported confidence in this room, 0..1. */
  confidence: number;
}

/** An opening a provider reports (normalised space). Persisted with
 *  source='parsed'; `derived` when the provider defaulted the dimensions. */
export interface RawProvidedOpening {
  wall_ref?: string | null;
  room_id?: string | null;
  type: "door" | "window" | "archway";
  width_mm?: number | null;
  height_mm?: number | null;
  sill_mm?: number | null;
  position: [number, number]; // normalised [x, y]
  along_offset?: number | null;
  derived?: boolean | null;
}

export interface RawParseResult {
  scale: string;
  units: "metric" | "imperial";
  total_area_m2: number;
  rooms: RawParsedRoom[];
  /** Optional: providers that detect doors/windows supply them here (the
   *  in-house Claude provider does not — it's forward-looking for a hosted /
   *  vector-extraction provider). Persisted to plan_openings. */
  openings?: RawProvidedOpening[];
  /** Optional: a provider that returns true measured walls may supply them
   *  here (not yet consumed — buildPlanGraph still derives walls from polygons). */
  walls?: unknown[];
}

export interface ParseProvider {
  /** Stable identifier persisted to parse_metrics / renders for tracing. */
  readonly name: string;
  parse(asset: ParseAsset): Promise<RawParseResult>;
}

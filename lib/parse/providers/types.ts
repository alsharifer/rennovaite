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
  /** Where `area_m2` came from. "measured" = read off a dimension the drawing
   *  prints, which outranks any polygon. "estimated" (the default) = the
   *  provider's own guess, which geometry may overrule. */
  area_source?: "measured" | "estimated";
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

/** How a PDF sheet's own text and vector layers were used, for tracing. Absent
 *  when the input was a raster/photo or the sheet could not be read. */
export interface SheetProvenance {
  /** "cropped" = the model saw only the plan region and the sheet's printed
   *  labels were folded in. "full-sheet" = the whole document went to the
   *  model, exactly as before. */
  path: "cropped" | "full-sheet";
  /** Why the crop path was not taken. null when it was. */
  fallback_reason: string | null;
  region: [number, number, number, number] | null;
  raster_px: [number, number] | null;
  scale_source: "text-layer" | "model" | "unknown";
  labels_total: number;
  labels_matched: number;
  label_area_room_ids: string[];
  label_only_room_ids: string[];
  unmatched_tags: string[];
}

export interface RawParseResult {
  scale: string;
  units: "metric" | "imperial";
  total_area_m2: number;
  rooms: RawParsedRoom[];
  /** Set by a provider that read the source as a vector CAD sheet. */
  sheet?: SheetProvenance;
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

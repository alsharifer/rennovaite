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

export interface RawParseResult {
  scale: string;
  units: "metric" | "imperial";
  total_area_m2: number;
  rooms: RawParsedRoom[];
}

export interface ParseProvider {
  /** Stable identifier persisted to parse_metrics / renders for tracing. */
  readonly name: string;
  parse(asset: ParseAsset): Promise<RawParseResult>;
}

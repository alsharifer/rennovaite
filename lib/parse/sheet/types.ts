// =============================================================================
// lib/parse/sheet/types.ts — what we read off a vector CAD sheet.
//
// A "sheet" is one page of a PDF that still carries its CAD text and vector
// layers. Everything here is plain data in PDF POINTS on that page (origin
// top-left, y down), so the pure modules beside this one can be unit-tested
// without opening a PDF.
// =============================================================================

/** One extracted text line with its bounding box, in PDF points. */
export interface SheetTextLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One flattened vector segment, in PDF points, with its pen width. */
export interface SheetSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Stroke width in points after the CTM. 0 for filled paths. */
  lw: number;
}

/** [x0, y0, x1, y1] in PDF points. */
export type Region = [number, number, number, number];

/** Everything a PDF page gives us before any interpretation. */
export interface SheetExtract {
  page_pt: [number, number];
  lines: SheetTextLine[];
  segments: SheetSegment[];
}

/** A room as the drawing itself labels it. */
export interface SheetRoomLabel {
  /** Room tag exactly as printed, normalised to no space: "F01". */
  tag: string;
  /** Room name as printed, e.g. "MASTER BEDROOM". null when only a tag exists. */
  name: string | null;
  /** [width, height] mm from a printed NNNNxNNNN label, else null. */
  dim_mm: [number, number] | null;
  /** Area in m² from `dim_mm`; null when the sheet prints no dimension. */
  area_m2: number | null;
  /** Centre of the tag box, PDF points on the page. */
  anchor_pt: [number, number];
}

export interface SheetScale {
  /** As printed, e.g. "1:100". "unknown" when the sheet does not state it. */
  scale: string;
  /** Drawing ratio denominator (100 for 1:100); null when unknown. */
  ratio: number | null;
  /** Millimetres of building per PDF point. null when the scale is unknown. */
  mm_per_pt: number | null;
  /** ISO sheet size the media box matches ("A0".."A4"), else null. */
  sheet_format: string | null;
  source: "text-layer" | "unknown";
}

/** The interpreted sheet: region, labels, scale — the inputs the parse needs. */
export interface SheetReading {
  page_pt: [number, number];
  /** Plan drawing region in PDF points, or null when detection failed. */
  region: Region | null;
  /** Why detection failed, for tracing. null when it succeeded. */
  region_reject_reason: string | null;
  labels: SheetRoomLabel[];
  scale: SheetScale;
  /** Counts kept for parse_metrics tracing. */
  stats: {
    text_lines: number;
    segments: number;
    labels_with_dims: number;
  };
}

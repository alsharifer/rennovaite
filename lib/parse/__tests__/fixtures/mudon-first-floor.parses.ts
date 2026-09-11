// =============================================================================
// Recorded parses of the Mudon first-floor CAD sheet, scored against
// `MUDON_GROUND_TRUTH`. Recording them makes the eval reproducible offline —
// the suite has no API key and must not make a network call.
//
// Re-record by running the current pipeline on the PDF named in the ground
// truth and pasting the output here with a new `recorded` date; never edit the
// numbers by hand.
// =============================================================================

export interface EvalRoom {
  id: string;
  name_en: string;
  room_type: string;
  area_m2: number;
  confidence?: number;
  /** Where `area_m2` came from: "measured" off a dimension the drawing prints,
   *  or the model's own estimate. Absent on parses recorded before the split. */
  area_source?: "measured" | "estimated";
  /** Normalised [0,1] polygon, open ring. */
  polygon: [number, number][];
}

export interface RecordedParse {
  label: string;
  /** What the parser was shown. */
  input: string;
  recorded: string;
  provider: string;
  model: string | null;
  scale: string;
  total_area_m2: number;
  /** Wall-clock of the provider call, seconds. null for the DB snapshot. */
  latency_s: number | null;
  rooms: EvalRoom[];
}

// -- Fixture #1 -------------------------------------------------------------
// The Mudon parse as persisted in the pilot database, captured during the P1
// build (identical rooms to lib/plan/__tests__/mudon.fixture.ts). It predates
// both the N-vertex provider contract and the overlap-repair step, so it is
// the "before" datapoint: 13/13 axis-aligned quads, never repaired.
export const PARSE_1_LEGACY_PERSISTED: RecordedParse = {
  label: "#1 legacy persisted parse (pre-S4, from DB)",
  input: "full A2 sheet as a PDF document block",
  recorded: "2026-07 (P1 build)",
  provider: "pre-provider inline parse",
  model: null,
  scale: "1:100",
  total_area_m2: 178.5,
  latency_s: null,
  rooms: [
    { id: "bath-01", name_en: "Bath", room_type: "bathroom", area_m2: 4.7, polygon: [[0.52, 0.42], [0.62, 0.42], [0.62, 0.52], [0.52, 0.52]] },
    { id: "bed3-01", name_en: "Bedroom 3", room_type: "bedroom", area_m2: 16.8, polygon: [[0.46, 0.28], [0.62, 0.28], [0.62, 0.46], [0.46, 0.46]] },
    { id: "bed4-01", name_en: "Bedroom 4", room_type: "bedroom", area_m2: 19.9, polygon: [[0.46, 0.62], [0.64, 0.62], [0.64, 0.78], [0.46, 0.78]] },
    { id: "dress-01", name_en: "Dressing Room", room_type: "closet", area_m2: 4.7, polygon: [[0.28, 0.58], [0.4, 0.58], [0.4, 0.66], [0.28, 0.66]] },
    { id: "family-01", name_en: "Family Area", room_type: "living", area_m2: 24, polygon: [[0.36, 0.46], [0.52, 0.46], [0.52, 0.62], [0.36, 0.62]] },
    { id: "balc-01", name_en: "Front Balcony", room_type: "balcony", area_m2: 6.5, polygon: [[0.3, 0.28], [0.46, 0.28], [0.46, 0.38], [0.3, 0.38]] },
    { id: "mbath-01", name_en: "Master Bath", room_type: "ensuite", area_m2: 4.7, polygon: [[0.28, 0.66], [0.4, 0.66], [0.4, 0.74], [0.28, 0.74]] },
    { id: "mbed-01", name_en: "Master Bedroom", room_type: "master_bedroom", area_m2: 19.9, polygon: [[0.28, 0.38], [0.45, 0.38], [0.45, 0.58], [0.28, 0.58]] },
    { id: "pass-01", name_en: "Passage", room_type: "foyer", area_m2: 5.2, polygon: [[0.45, 0.46], [0.55, 0.46], [0.55, 0.62], [0.45, 0.62]] },
    { id: "stair-01", name_en: "Stairs", room_type: "stairs", area_m2: 7.2, polygon: [[0.55, 0.3], [0.66, 0.3], [0.66, 0.46], [0.55, 0.46]] },
    { id: "terr-01", name_en: "Terrace", room_type: "terrace", area_m2: 13, polygon: [[0.62, 0.28], [0.78, 0.28], [0.78, 0.46], [0.62, 0.46]] },
    { id: "terr-02", name_en: "Terrace 2", room_type: "terrace", area_m2: 16.4, polygon: [[0.3, 0.72], [0.64, 0.72], [0.64, 0.84], [0.3, 0.84]] },
    { id: "toilet-01", name_en: "Toilet", room_type: "powder", area_m2: 2.7, polygon: [[0.54, 0.56], [0.62, 0.56], [0.62, 0.63], [0.54, 0.63]] },
  ],
};

// -- Fixture #2 -------------------------------------------------------------
// The current production path, re-run on 2026-09-11: PARSE_PROVIDER unset →
// the in-house Claude-vision provider, whole PDF handed to the API as a
// `document` block, then `repairOverlaps`. Recorded before AND after repair,
// because the two disagree sharply and the difference is the finding.
export const PARSE_2_S4_RAW: RecordedParse = {
  label: "#2 current pipeline, provider output (pre-repair)",
  input: "full A2 sheet as a PDF document block",
  recorded: "2026-09-11",
  provider: "inhouse",
  model: "claude-sonnet-4-6",
  scale: "1:100",
  total_area_m2: 187.5,
  latency_s: 21.0,
  rooms: [
    { id: "master-bed-01", name_en: "Master Bedroom", room_type: "master_bedroom", area_m2: 19.93, confidence: 0.82, polygon: [[0.28, 0.38], [0.44, 0.38], [0.44, 0.6], [0.28, 0.6]] },
    { id: "closet-01", name_en: "Dressing Room", room_type: "closet", area_m2: 4.65, confidence: 0.75, polygon: [[0.28, 0.6], [0.38, 0.6], [0.38, 0.7], [0.28, 0.7]] },
    { id: "bathroom-01", name_en: "Bath", room_type: "ensuite", area_m2: 4.73, confidence: 0.75, polygon: [[0.38, 0.6], [0.44, 0.6], [0.44, 0.75], [0.38, 0.75]] },
    { id: "living-01", name_en: "Family Area", room_type: "living", area_m2: 19.95, confidence: 0.8, polygon: [[0.44, 0.47], [0.6, 0.47], [0.6, 0.65], [0.44, 0.65]] },
    { id: "passage-01", name_en: "Passage", room_type: "foyer", area_m2: 5.2, confidence: 0.68, polygon: [[0.56, 0.47], [0.66, 0.47], [0.66, 0.65], [0.56, 0.65]] },
    { id: "bedroom-01", name_en: "Bedroom 3", room_type: "bedroom", area_m2: 16.8, confidence: 0.82, polygon: [[0.56, 0.27], [0.74, 0.27], [0.74, 0.47], [0.56, 0.47]] },
    { id: "bathroom-02", name_en: "Bath", room_type: "bathroom", area_m2: 4.73, confidence: 0.73, polygon: [[0.65, 0.47], [0.74, 0.47], [0.74, 0.58], [0.65, 0.58]] },
    { id: "bathroom-03", name_en: "Toilet", room_type: "powder", area_m2: 2.7, confidence: 0.72, polygon: [[0.6, 0.58], [0.68, 0.58], [0.68, 0.67], [0.6, 0.67]] },
    { id: "bedroom-02", name_en: "Bedroom 4", room_type: "bedroom", area_m2: 19.93, confidence: 0.8, polygon: [[0.44, 0.65], [0.68, 0.65], [0.68, 0.82], [0.44, 0.82]] },
    { id: "stairs-01", name_en: "Stairs", room_type: "stairs", area_m2: 8.5, confidence: 0.7, polygon: [[0.44, 0.27], [0.58, 0.27], [0.58, 0.47], [0.44, 0.47]] },
    { id: "balcony-01", name_en: "First Floor Balcony", room_type: "balcony", area_m2: 6, confidence: 0.65, polygon: [[0.28, 0.27], [0.44, 0.27], [0.44, 0.38], [0.28, 0.38]] },
    { id: "terrace-01", name_en: "Terrace", room_type: "terrace", area_m2: 16.35, confidence: 0.68, polygon: [[0.28, 0.82], [0.68, 0.82], [0.68, 0.92], [0.28, 0.92]] },
    { id: "terrace-02", name_en: "Terrace (Front)", room_type: "terrace", area_m2: 10, confidence: 0.62, polygon: [[0.68, 0.27], [0.82, 0.27], [0.82, 0.55], [0.68, 0.55]] },
  ],
};

export const PARSE_2_S4_REPAIRED: RecordedParse = {
  label: "#2 current pipeline, what is written to the DB (post-repair)",
  input: "full A2 sheet as a PDF document block",
  recorded: "2026-09-11",
  provider: "inhouse",
  model: "claude-sonnet-4-6",
  scale: "1:100",
  total_area_m2: 187.5,
  latency_s: 21.0,
  rooms: [
    { id: "master-bed-01", name_en: "Master Bedroom", room_type: "master_bedroom", area_m2: 23.18, confidence: 0.82, polygon: [[0.280004, 0.380014], [0.440012, 0.380014], [0.440012, 0.600021], [0.280004, 0.600021]] },
    { id: "closet-01", name_en: "Dressing Room", room_type: "closet", area_m2: 6.58, confidence: 0.75, polygon: [[0.280004, 0.600021], [0.380014, 0.600021], [0.380014, 0.69999], [0.280004, 0.69999]] },
    { id: "bathroom-01", name_en: "Bath", room_type: "ensuite", area_m2: 5.92, confidence: 0.75, polygon: [[0.380014, 0.600021], [0.440012, 0.600021], [0.440012, 0.749995], [0.380014, 0.749995]] },
    { id: "living-01", name_en: "Family Area", room_type: "living", area_m2: 18.96, confidence: 0.8, polygon: [[0.440012, 0.600021], [0.440012, 0.469991], [0.600021, 0.469991], [0.600021, 0.649985], [0.440012, 0.649985]] },
    { id: "passage-01", name_en: "Passage", room_type: "foyer", area_m2: 3.62, confidence: 0.55, polygon: [[0.600021, 0.469991], [0.649985, 0.469991], [0.649985, 0.579994], [0.600021, 0.579994]] },
    { id: "bedroom-01", name_en: "Bedroom 3", room_type: "bedroom", area_m2: 23.7, confidence: 0.82, polygon: [[0.560008, 0.270011], [0.740002, 0.270011], [0.740002, 0.469991], [0.560008, 0.469991]] },
    { id: "bathroom-02", name_en: "Bath", room_type: "bathroom", area_m2: 6.52, confidence: 0.73, polygon: [[0.649985, 0.469991], [0.740002, 0.469991], [0.740002, 0.579994], [0.649985, 0.579994]] },
    { id: "bathroom-03", name_en: "Toilet", room_type: "powder", area_m2: 3.69, confidence: 0.55, polygon: [[0.600021, 0.579994], [0.680004, 0.579994], [0.680004, 0.649985], [0.600021, 0.649985]] },
    { id: "bedroom-02", name_en: "Bedroom 4", room_type: "bedroom", area_m2: 26.86, confidence: 0.8, polygon: [[0.440012, 0.649985], [0.680004, 0.649985], [0.680004, 0.819986], [0.440012, 0.819986]] },
    { id: "stairs-01", name_en: "Stairs", room_type: "stairs", area_m2: 15.8, confidence: 0.7, polygon: [[0.440012, 0.270011], [0.579994, 0.270011], [0.560008, 0.270011], [0.560008, 0.469991], [0.440012, 0.469991], [0.440012, 0.380014]] },
    { id: "balcony-01", name_en: "First Floor Balcony", room_type: "balcony", area_m2: 11.59, confidence: 0.65, polygon: [[0.280004, 0.270011], [0.440012, 0.270011], [0.440012, 0.380014], [0.280004, 0.380014]] },
    { id: "terrace-01", name_en: "Terrace", room_type: "terrace", area_m2: 26.34, confidence: 0.68, polygon: [[0.280004, 0.819986], [0.680004, 0.819986], [0.680004, 0.919996], [0.280004, 0.919996]] },
    { id: "terrace-02", name_en: "Terrace (Front)", room_type: "terrace", area_m2: 14.75, confidence: 0.55, polygon: [[0.680004, 0.270011], [0.819986, 0.270011], [0.819986, 0.550015], [0.740002, 0.550015], [0.740002, 0.270011]] },
  ],
};

// -- Diagnostic -------------------------------------------------------------
// Same provider, same prompt, same day — but shown ONLY the plan region
// (MUDON_SHEET.plan_region_pt), rasterised to the same pixel budget the API
// gives a whole A2 page. Nothing in the product does this today; it is here
// because it is the control that isolates input framing from model quality,
// and the suite pins the gap so it cannot quietly disappear.
export const PARSE_2D_CROPPED_DIAGNOSTIC: RecordedParse = {
  label: "#2d diagnostic — same model, plan region only (NOT the product path)",
  input: "plan region cropped from the sheet, 783x1493 px",
  recorded: "2026-09-11",
  provider: "inhouse",
  model: "claude-sonnet-4-6",
  scale: "unknown",
  total_area_m2: 148.5,
  latency_s: 22.2,
  rooms: [
    { id: "master-bed-01", name_en: "Master Bedroom", room_type: "master_bedroom", area_m2: 19.93, confidence: 0.82, polygon: [[0.18, 0.38], [0.5, 0.38], [0.5, 0.62], [0.18, 0.62]] },
    { id: "closet-01", name_en: "Dressing Room", room_type: "closet", area_m2: 4.65, confidence: 0.78, polygon: [[0.18, 0.62], [0.36, 0.62], [0.36, 0.72], [0.18, 0.72]] },
    { id: "bathroom-01", name_en: "Bath (Master)", room_type: "ensuite", area_m2: 8.79, confidence: 0.78, polygon: [[0.18, 0.72], [0.36, 0.72], [0.36, 0.88], [0.18, 0.88]] },
    { id: "balcony-01", name_en: "F-Balcony (Master)", room_type: "balcony", area_m2: 5.2, confidence: 0.72, polygon: [[0.18, 0.3], [0.5, 0.3], [0.5, 0.38], [0.18, 0.38]] },
    { id: "living-01", name_en: "Family Area", room_type: "living", area_m2: 12.54, confidence: 0.8, polygon: [[0.5, 0.5], [0.68, 0.5], [0.68, 0.72], [0.5, 0.72]] },
    { id: "foyer-01", name_en: "Passage", room_type: "foyer", area_m2: 4.2, confidence: 0.7, polygon: [[0.68, 0.55], [0.78, 0.55], [0.78, 0.68], [0.68, 0.68]] },
    { id: "bedroom-01", name_en: "Bedroom 3", room_type: "bedroom", area_m2: 16.8, confidence: 0.82, polygon: [[0.68, 0.3], [0.95, 0.3], [0.95, 0.52], [0.68, 0.52]] },
    { id: "bathroom-02", name_en: "Bath (Bedroom 3)", room_type: "bathroom", area_m2: 4.73, confidence: 0.75, polygon: [[0.68, 0.52], [0.88, 0.52], [0.88, 0.62], [0.68, 0.62]] },
    { id: "powder-01", name_en: "Toilet", room_type: "powder", area_m2: 2.7, confidence: 0.72, polygon: [[0.68, 0.7], [0.88, 0.7], [0.88, 0.78], [0.68, 0.78]] },
    { id: "bedroom-02", name_en: "Bedroom 4", room_type: "bedroom", area_m2: 19.2, confidence: 0.82, polygon: [[0.68, 0.78], [0.95, 0.78], [0.95, 0.96], [0.68, 0.96]] },
    { id: "balcony-02", name_en: "F-Balcony (Bedroom 4)", room_type: "balcony", area_m2: 4.5, confidence: 0.65, polygon: [[0.68, 0.96], [0.95, 0.96], [0.95, 1], [0.68, 1]] },
    { id: "terrace-01", name_en: "Terrace (Front)", room_type: "terrace", area_m2: 16, confidence: 0.68, polygon: [[0.28, 0.86], [0.6, 0.86], [0.6, 1], [0.28, 1]] },
    { id: "terrace-02", name_en: "Terrace (Top)", room_type: "terrace", area_m2: 18.8, confidence: 0.65, polygon: [[0.68, 0.14], [0.95, 0.14], [0.95, 0.3], [0.68, 0.3]] },
    { id: "stairs-01", name_en: "Stairs", room_type: "stairs", area_m2: 8.5, confidence: 0.72, polygon: [[0.5, 0.3], [0.68, 0.3], [0.68, 0.5], [0.5, 0.5]] },
  ],
};

// -- Fixture #2, after the sheet-first rebuild ------------------------------
// Same PDF, same prompt, same model. What changed is what the model was shown
// (the plan region, not the whole A2 page) and who wins on names and areas (the
// sheet's printed labels, not the model). Recorded from the shipped pipeline
// end to end: readSheet → crop → vision → reconcileWithSheet → repairOverlaps.
//
// The eight MEASURED areas are the drawing's own arithmetic and are stable
// run to run. The ESTIMATED ones — stairs, terraces, balconies, passage, none
// of which the sheet dimensions — are the model's and will move between runs,
// so the tests assert on them loosely or not at all.
export const PARSE_3_SHEET_FIRST: RecordedParse = {
  label: "#2 after — sheet-first pipeline (what ships)",
  input: "plan region cropped from the sheet, 782x1470 px, labels reconciled",
  recorded: "2026-09-11",
  provider: "inhouse",
  model: "claude-sonnet-4-6",
  scale: "1:100",
  total_area_m2: 139.63,
  latency_s: 26.2,
  rooms: [
    { id: "master-bed-01", name_en: "Master Bedroom", room_type: "master_bedroom", area_m2: 19.93, confidence: 0.85, area_source: "measured", polygon: [[0.139984, 0.379989], [0.420008, 0.379989], [0.420008, 0.619993], [0.139984, 0.619993]] },
    { id: "closet-01", name_en: "Dress", room_type: "closet", area_m2: 4.65, confidence: 0.82, area_source: "measured", polygon: [[0.139984, 0.619993], [0.300006, 0.619993], [0.300006, 0.720013], [0.139984, 0.720013]] },
    { id: "bathroom-01", name_en: "Bath", room_type: "ensuite", area_m2: 8.79, confidence: 0.82, area_source: "measured", polygon: [[0.139984, 0.720013], [0.300006, 0.720013], [0.300006, 0.87998], [0.139984, 0.87998]] },
    { id: "living-01", name_en: "Family Area", room_type: "living", area_m2: 12.54, confidence: 0.83, area_source: "measured", polygon: [[0.420008, 0.619993], [0.420008, 0.519973], [0.600011, 0.519973], [0.600011, 0.720013], [0.420008, 0.720013]] },
    { id: "stairs-01", name_en: "Stairs", room_type: "stairs", area_m2: 7.5, confidence: 0.75, area_source: "estimated", polygon: [[0.420008, 0.379989], [0.600011, 0.379989], [0.600011, 0.519973], [0.420008, 0.519973]] },
    { id: "bedroom-01", name_en: "Bedroom 3", room_type: "bedroom", area_m2: 16.8, confidence: 0.85, area_source: "measured", polygon: [[0.619993, 0.379989], [0.87998, 0.379989], [0.87998, 0.569983], [0.619993, 0.569983]] },
    { id: "terrace-01", name_en: "Terrace", room_type: "terrace", area_m2: 9.5, confidence: 0.75, area_source: "estimated", polygon: [[0.619993, 0.249996], [0.87998, 0.249996], [0.87998, 0.379989], [0.619993, 0.379989]] },
    { id: "bathroom-02", name_en: "Bath", room_type: "bathroom", area_m2: 4.72, confidence: 0.8, area_source: "measured", polygon: [[0.619993, 0.569983], [0.780015, 0.569983], [0.780015, 0.679995], [0.619993, 0.679995]] },
    { id: "foyer-01", name_en: "Passage", room_type: "foyer", area_m2: 4, confidence: 0.55, area_source: "estimated", polygon: [[0.600011, 0.569983], [0.619993, 0.569983], [0.619993, 0.650021], [0.600011, 0.650021]] },
    { id: "powder-01", name_en: "Toilet", room_type: "powder", area_m2: 2.7, confidence: 0.8, area_source: "measured", polygon: [[0.619993, 0.679995], [0.780015, 0.679995], [0.780015, 0.759978], [0.619993, 0.759978]] },
    { id: "bedroom-02", name_en: "Bedroom-4", room_type: "bedroom", area_m2: 19.2, confidence: 0.85, area_source: "measured", polygon: [[0.619993, 0.759978], [0.87998, 0.759978], [0.87998, 0.919999], [0.619993, 0.919999]] },
    { id: "balcony-01", name_en: "F-Balcony", room_type: "balcony", area_m2: 3.5, confidence: 0.72, area_source: "estimated", polygon: [[0.139984, 0.319988], [0.400026, 0.319988], [0.400026, 0.379989], [0.139984, 0.379989]] },
    { id: "balcony-02", name_en: "F-Balcony", room_type: "balcony", area_m2: 3.8, confidence: 0.72, area_source: "estimated", polygon: [[0.619993, 0.919999], [0.87998, 0.919999], [0.87998, 0.970009], [0.619993, 0.970009]] },
    { id: "terrace-02", name_en: "Terrace", room_type: "terrace", area_m2: 22, confidence: 0.7, area_source: "estimated", polygon: [[0.180003, 0.87998], [0.579974, 0.87998], [0.579974, 0.999982], [0.180003, 0.999982]] },
  ],
};

// A SECOND post-build sample, re-run 2026-09-11 after the area-provenance fix.
//
// Two reasons it is here rather than replacing the first. It shows the result
// is not one lucky recording — a vision model is not deterministic, and two
// independent runs both hitting 13/13 rooms and 8/8 exact areas is a different
// claim from one. And this one raised a real dispute: the sheet prints
// 2700x1750 on F08 and the outline the model drew for it is worth more than
// twice that, so the printed figure was kept, the room was flagged, and both
// numbers went to the editor to be settled by someone who can look at the
// drawing. That path had no live coverage until this run produced one.
export const PARSE_3B_SHEET_FIRST_RERUN: RecordedParse = {
  label: "#2 after the rebuild, second sample (raised a live dispute)",
  input: "plan region cropped from the sheet, 782x1470 px; scale from the text layer",
  recorded: "2026-09-11",
  provider: "inhouse",
  model: "claude-sonnet-4-6",
  scale: "1:100",
  total_area_m2: 141.63,
  latency_s: 27.5,
  rooms: [
    { id: "master-bed-01", name_en: "Master Bedroom", room_type: "master_bedroom", area_m2: 19.93, area_source: "measured", confidence: 0.85, polygon: [[0.13002, 0.370025], [0.420024, 0.370025], [0.420024, 0.620019], [0.13002, 0.620019]] },
    { id: "closet-01", name_en: "Dress", room_type: "closet", area_m2: 4.65, area_source: "measured", confidence: 0.82, polygon: [[0.13002, 0.620019], [0.320027, 0.620019], [0.320027, 0.720017], [0.13002, 0.720017]] },
    { id: "bathroom-01", name_en: "Bath", room_type: "ensuite", area_m2: 8.79, area_source: "measured", confidence: 0.82, polygon: [[0.13002, 0.720017], [0.320027, 0.720017], [0.320027, 0.870013], [0.13002, 0.870013]] },
    { id: "living-01", name_en: "Family Area", room_type: "living", area_m2: 12.54, area_source: "measured", confidence: 0.83, polygon: [[0.420024, 0.620019], [0.420024, 0.520022], [0.599985, 0.520022], [0.599985, 0.580009], [0.599985, 0.749982], [0.420024, 0.749982]] },
    { id: "bedroom-01", name_en: "Bedroom 3", room_type: "bedroom", area_m2: 16.8, area_source: "measured", confidence: 0.85, polygon: [[0.599985, 0.370025], [0.880002, 0.370025], [0.880002, 0.580009], [0.599985, 0.580009]] },
    { id: "bathroom-02", name_en: "Bath", room_type: "bathroom", area_m2: 4.72, area_source: "measured", confidence: 0.55, polygon: [[0.599985, 0.580009], [0.880002, 0.580009], [0.880002, 0.699983], [0.599985, 0.699983]] },
    { id: "foyer-01", name_en: "Passage", room_type: "foyer", area_m2: 4.2, area_source: "estimated", confidence: 0.72, polygon: [[0.599985, 0.699983], [0.780004, 0.699983], [0.780004, 0.799981], [0.599985, 0.799981]] },
    { id: "powder-01", name_en: "Toilet", room_type: "powder", area_m2: 2.7, area_source: "measured", confidence: 0.78, polygon: [[0.599985, 0.799981], [0.780004, 0.799981], [0.780004, 0.880002], [0.599985, 0.880002]] },
    { id: "bedroom-02", name_en: "Bedroom-4", room_type: "bedroom", area_m2: 19.2, area_source: "measured", confidence: 0.82, polygon: [[0.599985, 0.880002], [0.880002, 0.880002], [0.880002, 0.999976], [0.599985, 0.999976]] },
    { id: "stairs-01", name_en: "Stairs", room_type: "stairs", area_m2: 8.5, area_source: "estimated", confidence: 0.75, polygon: [[0.420024, 0.370025], [0.599985, 0.370025], [0.599985, 0.520022], [0.420024, 0.520022]] },
    { id: "balcony-01", name_en: "F-Balcony", room_type: "balcony", area_m2: 5.5, area_source: "estimated", confidence: 0.75, polygon: [[0.13002, 0.280016], [0.420024, 0.280016], [0.420024, 0.370025], [0.13002, 0.370025]] },
    { id: "terrace-01", name_en: "Terrace", room_type: "terrace", area_m2: 18, area_source: "estimated", confidence: 0.72, polygon: [[0.13002, 0.870013], [0.320027, 0.870013], [0.549987, 0.870013], [0.549987, 0.999976], [0.13002, 0.999976]] },
    { id: "terrace-02", name_en: "Terrace", room_type: "terrace", area_m2: 11.6, area_source: "estimated", confidence: 0.7, polygon: [[0.599985, 0.280016], [0.880002, 0.280016], [0.880002, 0.370025], [0.599985, 0.370025]] },
    { id: "balcony-02", name_en: "F-Balcony", room_type: "balcony", area_m2: 4.5, area_source: "estimated", confidence: 0.65, polygon: [[0.599985, 0.999976], [0.880002, 0.999976], [0.880002, 1.049974], [0.599985, 1.049974]] },
  ],
};

/** The dispute that run raised, exactly as `repairOverlaps` recorded it. */
export const PARSE_3B_DISPUTES = [
  { room_id: "bathroom-02", stated_area_m2: 4.72, geometric_area_m2: 10.2 },
];

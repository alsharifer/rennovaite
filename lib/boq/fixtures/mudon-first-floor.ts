// =============================================================================
// Canonical pilot villa — Mudon Al Naseem F2, Villa 94, FIRST-FLOOR renovation.
//
// v0.2: room list and areas calibrated against the REAL project documents —
// Newspace SOW-R02, the Rev-00 flooring shop drawing (FL-01 bedrooms 61 m²,
// FL-02 living 34 m², bath floors ≈ 18 m²), and the dimensions drawing.
// First floor actually has THREE bathrooms (Master, Kids 1, Kids 2), a
// corridor, a storage room, plus the terrace + office build-out (~70 m²).
// Splits between individual bedrooms/bathrooms are estimates within
// document-confirmed totals — refine from the dimensions drawing if needed.
// =============================================================================

import type { EngineRoom } from "../schema";

export const MUDON_FIRST_FLOOR: EngineRoom[] = [
  {
    id: "master-bedroom",
    name: "Master Bedroom",
    room_type: "master_bedroom",
    area_m2: 24.0,
    polygon: [
      [0, 0],
      [52, 0],
      [52, 40],
      [0, 40],
    ], // aspect 1.3
  },
  {
    id: "kids-bedroom-1",
    name: "Kids Bedroom 1",
    room_type: "bedroom",
    area_m2: 18.5,
    polygon: [
      [0, 0],
      [46, 0],
      [46, 38],
      [0, 38],
    ], // aspect ~1.2
  },
  {
    id: "kids-bedroom-2",
    name: "Kids Bedroom 2",
    room_type: "bedroom",
    area_m2: 18.5,
    polygon: [
      [0, 0],
      [46, 0],
      [46, 38],
      [0, 38],
    ], // aspect ~1.2
  },
  {
    id: "master-bathroom",
    name: "Master Bathroom",
    room_type: "bathroom",
    area_m2: 8.7, // travertine zone on FL drawing
    polygon: [
      [0, 0],
      [40, 0],
      [40, 25],
      [0, 25],
    ], // aspect 1.6
  },
  {
    id: "kids-bathroom-1",
    name: "Kids Bathroom 1",
    room_type: "bathroom",
    area_m2: 4.7,
    polygon: [
      [0, 0],
      [38, 0],
      [38, 24],
      [0, 24],
    ], // aspect ~1.58
  },
  {
    id: "kids-bathroom-2",
    name: "Kids Bathroom 2",
    room_type: "bathroom",
    area_m2: 4.6,
    polygon: [
      [0, 0],
      [38, 0],
      [38, 24],
      [0, 24],
    ], // aspect ~1.58
  },
  {
    id: "living-family",
    name: "Family Living Area",
    room_type: "living",
    area_m2: 34.0, // FL-02 green zone
    polygon: [
      [0, 0],
      [60, 0],
      [60, 42],
      [0, 42],
    ], // aspect ~1.43
  },
  {
    id: "corridor",
    name: "Corridor",
    room_type: "corridor",
    area_m2: 12.0,
    polygon: [
      [0, 0],
      [60, 0],
      [60, 20],
      [0, 20],
    ], // aspect 3.0 (long)
  },
  {
    id: "storage",
    name: "Storage Room (new)",
    room_type: "storage",
    area_m2: 4.0,
    polygon: [
      [0, 0],
      [28, 0],
      [28, 20],
      [0, 20],
    ], // aspect 1.4
  },
  {
    id: "office",
    name: "Office (build-out)",
    room_type: "office",
    area_m2: 20.0, // SoW §9.4
    polygon: [
      [0, 0],
      [52, 0],
      [52, 40],
      [0, 40],
    ], // aspect 1.3
  },
  {
    id: "terrace",
    name: "Terrace Balcony",
    room_type: "terrace",
    area_m2: 50.0, // terrace + office ≈ 70 m² per SoW §3.4, office is 20
    polygon: [
      [0, 0],
      [70, 0],
      [70, 40],
      [0, 40],
    ], // aspect 1.75
  },
];

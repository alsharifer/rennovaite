// Canonical Mudon pilot villa (project 6b5fda9d, plan d09e105d) as persisted
// today — normalised [0,1] room rectangles, authoritative area_m2. Captured
// from the live DB during the P1 build so the geometry contract is tested
// against real parse output without a database connection.

import type { BuildPlanGraphInput } from "@/lib/plan/geometry";

export const MUDON_FIXTURE: BuildPlanGraphInput = {
  projectId: "6b5fda9d-e40f-4e16-940c-7a17d27ec5dc",
  planId: "d09e105d-17e9-4737-9f7d-3bd51acda43f",
  scale: "1:100",
  total_area_m2: 178.5,
  rooms: [
    { id: "bath-01", name_en: "Bath", name_ar: null, room_type: "bathroom", area_m2: 4.7, polygon: [[0.52, 0.42], [0.62, 0.42], [0.62, 0.52], [0.52, 0.52]] },
    { id: "bed3-01", name_en: "Bedroom 3", name_ar: null, room_type: "bedroom", area_m2: 16.8, polygon: [[0.46, 0.28], [0.62, 0.28], [0.62, 0.46], [0.46, 0.46]] },
    { id: "bed4-01", name_en: "Bedroom 4", name_ar: null, room_type: "bedroom", area_m2: 19.9, polygon: [[0.46, 0.62], [0.64, 0.62], [0.64, 0.78], [0.46, 0.78]] },
    { id: "dress-01", name_en: "Dressing Room", name_ar: null, room_type: "closet", area_m2: 4.7, polygon: [[0.28, 0.58], [0.4, 0.58], [0.4, 0.66], [0.28, 0.66]] },
    { id: "family-01", name_en: "Family Area", name_ar: "غرفة المعيشة", room_type: "living", area_m2: 24, polygon: [[0.36, 0.46], [0.52, 0.46], [0.52, 0.62], [0.36, 0.62]] },
    { id: "balc-01", name_en: "Front Balcony", name_ar: null, room_type: "balcony", area_m2: 6.5, polygon: [[0.3, 0.28], [0.46, 0.28], [0.46, 0.38], [0.3, 0.38]] },
    { id: "mbath-01", name_en: "Master Bath", name_ar: null, room_type: "ensuite", area_m2: 4.7, polygon: [[0.28, 0.66], [0.4, 0.66], [0.4, 0.74], [0.28, 0.74]] },
    { id: "mbed-01", name_en: "Master Bedroom", name_ar: "غرفة النوم الرئيسية", room_type: "master_bedroom", area_m2: 19.9, polygon: [[0.28, 0.38], [0.45, 0.38], [0.45, 0.58], [0.28, 0.58]] },
    { id: "pass-01", name_en: "Passage", name_ar: null, room_type: "foyer", area_m2: 5.2, polygon: [[0.45, 0.46], [0.55, 0.46], [0.55, 0.62], [0.45, 0.62]] },
    { id: "stair-01", name_en: "Stairs", name_ar: null, room_type: "stairs", area_m2: 7.2, polygon: [[0.55, 0.3], [0.66, 0.3], [0.66, 0.46], [0.55, 0.46]] },
    { id: "terr-01", name_en: "Terrace", name_ar: null, room_type: "terrace", area_m2: 13, polygon: [[0.62, 0.28], [0.78, 0.28], [0.78, 0.46], [0.62, 0.46]] },
    { id: "terr-02", name_en: "Terrace 2", name_ar: null, room_type: "terrace", area_m2: 16.4, polygon: [[0.3, 0.72], [0.64, 0.72], [0.64, 0.84], [0.3, 0.84]] },
    { id: "toilet-01", name_en: "Toilet", name_ar: null, room_type: "powder", area_m2: 2.7, polygon: [[0.54, 0.56], [0.62, 0.56], [0.62, 0.63], [0.54, 0.63]] },
  ],
};

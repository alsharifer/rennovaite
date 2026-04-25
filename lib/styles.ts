// Static style library for the pilot. Each entry is a renovation "direction"
// the user can pick at /project/[id]/style. The four rooms covered by the
// first-floor scope (master bedroom, secondary bedroom, shared bathroom,
// central living) each have a moodboard reference image stored in the
// Supabase 'moodboards' bucket and named `{style-key}-{room}.png`.
//
// cost_delta_aed is signed and expressed against a baseline mid-market
// villa refit (~AED 250–350k for a first-floor refit in Mudon Al Naseem).
// Negative means cheaper than baseline; positive means more expensive.

// Moodboards are served from public/moodboards/ (copied there from
// assets/moodboards/ so Next can serve them, since Next only serves /public).
// To regenerate, copy `mood-<name_en>-<room>.png` files into
// public/moodboards/ as `<style-key>-<room>.png`.
const ROOMS = ["bedroom", "secondary-bedroom", "bathroom", "living"] as const;

function imagesFor(
  styleKey: string,
): [string, string, string, string] {
  return ROOMS.map(
    (room) => `/moodboards/${styleKey}-${room}.png`,
  ) as [string, string, string, string];
}

export type Style = {
  key: string;
  name_en: string;
  name_ar: string;
  one_line: string;
  cost_delta_aed: number;
  palette: [string, string, string, string];
  reference_images: [string, string, string, string];
};

export const STYLES: Style[] = [
  {
    key: "contemporary-majlis",
    name_en: "Contemporary Majlis",
    name_ar: "المجلس المعاصر",
    one_line:
      "Clean geometry meets traditional hospitality — neutral palettes, low silhouettes, and sculptural light fixtures.",
    cost_delta_aed: 0,
    palette: ["#F5F1EA", "#2C2A28", "#B08D57", "#6B6F50"],
    reference_images: imagesFor("contemporary-majlis"),
  },
  {
    key: "modern-hijazi",
    name_en: "Modern Hijazi",
    name_ar: "الحجازي العصري",
    one_line:
      "Carved mashrabiya screens, deep teal walls, and burnished brass — Hijazi craft tailored to a modern floorplan.",
    cost_delta_aed: 35000,
    palette: ["#C9A86B", "#1F4E5F", "#6B2C2C", "#EFE6D6"],
    reference_images: imagesFor("modern-hijazi"),
  },
  {
    key: "coastal-emirati",
    name_en: "Coastal Emirati",
    name_ar: "الإماراتي الساحلي",
    one_line:
      "Bleached wood, woven jute, and sea-glass blues — a Gulf weekend-house feel for a year-round home.",
    cost_delta_aed: -8000,
    palette: ["#F4F2EC", "#C7B59B", "#4FA3A3", "#B7CDD9"],
    reference_images: imagesFor("coastal-emirati"),
  },
  {
    key: "scandi-arabic",
    name_en: "Scandi-Arabic",
    name_ar: "الإسكندنافي العربي",
    one_line:
      "Pale ash, white linen, and a single mashrabiya silhouette — Nordic restraint with a Gulf signature.",
    cost_delta_aed: -10000,
    palette: ["#F8F6F2", "#DCD4C5", "#9DA88E", "#C9B79A"],
    reference_images: imagesFor("scandi-arabic"),
  },
  {
    key: "andalusian-heritage",
    name_en: "Andalusian Heritage",
    name_ar: "التراث الأندلسي",
    one_line:
      "Hand-cut zellige, carved plaster, and saturated cobalt — a full-throated Moorish-Andalusian revival.",
    cost_delta_aed: 60000,
    palette: ["#1A3A6E", "#C2553D", "#D4A24C", "#F0E8D4"],
    reference_images: imagesFor("andalusian-heritage"),
  },
  {
    key: "luxe-minimal",
    name_en: "Luxe Minimal",
    name_ar: "الفاخر البسيط",
    one_line:
      "Honed stone, smoked oak, and concealed everything — invisible craftsmanship at the top of the market.",
    cost_delta_aed: 90000,
    palette: ["#F5F2ED", "#4A3F35", "#C9A66B", "#2A2826"],
    reference_images: imagesFor("luxe-minimal"),
  },
];

export function getStyleByKey(key: string): Style | undefined {
  return STYLES.find((s) => s.key === key);
}

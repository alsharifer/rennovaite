// Static style library for the pilot. Each entry is a renovation "direction"
// the user can pick at /project/[id]/style. The four rooms covered by the
// first-floor scope (master bedroom, secondary bedroom, shared bathroom,
// central living) each have a moodboard reference image stored in the
// Supabase 'moodboards' bucket and named `{style-key}-{room}.png`.
//
// cost_delta_aed is signed against the AED 850k canonical Mudon first-floor
// refit baseline shown in the Budget panel on the style page. Negative =
// cheaper than baseline; positive = more expensive. Editorial copy + deltas
// are the values rendered by app/project/[id]/style; the keys are stored in
// the style_choices table so they must NOT change without a data migration.

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
  /**
   * Three short notes shown in the Budget panel under the chosen style.
   * Each is a single sentence — no leading bullets, no terminal period
   * dependency on rendering; copy is editorial.
   */
  what_changes: [string, string, string];
};

export const STYLES: Style[] = [
  {
    key: "contemporary-majlis",
    name_en: "Contemporary Majlis",
    name_ar: "المجلس المعاصر",
    one_line:
      "Walnut, brass, travertine. Warm, modern, and unmistakably Dubai.",
    cost_delta_aed: 60_000,
    palette: ["#F5F1EA", "#2C2A28", "#B08D57", "#6B6F50"],
    reference_images: imagesFor("contemporary-majlis"),
    what_changes: [
      "Living walls clad in book-matched walnut paneling.",
      "Brushed brass hardware throughout — handles, taps, switch plates.",
      "Entry and majlis floors swap to honed travertine.",
    ],
  },
  {
    key: "modern-hijazi",
    name_en: "Modern Hijazi",
    name_ar: "الحجازي العصري",
    one_line:
      "Carved wood screens, ivory plaster, deep mahogany.",
    cost_delta_aed: 85_000,
    palette: ["#C9A86B", "#1F4E5F", "#6B2C2C", "#EFE6D6"],
    reference_images: imagesFor("modern-hijazi"),
    what_changes: [
      "Carved mashrabiya screens replace standard doors into the majlis.",
      "Walls finished in hand-trowelled ivory Tadelakt plaster.",
      "Joinery upgrades to solid mahogany with hand-rubbed wax.",
    ],
  },
  {
    key: "coastal-emirati",
    name_en: "Coastal Emirati",
    name_ar: "الإماراتي الساحلي",
    one_line:
      "Bleached oak, rope details, sand-tone limewash.",
    cost_delta_aed: 0,
    palette: ["#F4F2EC", "#C7B59B", "#4FA3A3", "#B7CDD9"],
    reference_images: imagesFor("coastal-emirati"),
    what_changes: [
      "Engineered bleached-oak flooring across living areas.",
      "Walls limewashed in a soft sand tone — no flat paint.",
      "Rope-wrapped pendants and woven jute rugs replace stock fixtures.",
    ],
  },
  {
    key: "scandi-arabic",
    name_en: "Scandi-Arabic",
    name_ar: "الإسكندنافي العربي",
    one_line:
      "White oak, off-white, single brass note.",
    cost_delta_aed: -25_000,
    palette: ["#F8F6F2", "#DCD4C5", "#9DA88E", "#C9B79A"],
    reference_images: imagesFor("scandi-arabic"),
    what_changes: [
      "Off-white walls in flat matt — no accent walls.",
      "White-oak veneer joinery, simpler runs, lower meterage.",
      "One brass note: tapware. Everything else is matte black or white.",
    ],
  },
  {
    key: "andalusian-heritage",
    name_en: "Andalusian Heritage",
    name_ar: "التراث الأندلسي",
    one_line:
      "Patterned encaustic tile, dark beams, hand-glazed ceramics.",
    cost_delta_aed: 110_000,
    palette: ["#1A3A6E", "#C2553D", "#D4A24C", "#F0E8D4"],
    reference_images: imagesFor("andalusian-heritage"),
    what_changes: [
      "Hand-laid encaustic floor tile across living and majlis.",
      "Exposed dark-stained timber beams run the length of the ceilings.",
      "Hand-glazed ceramic feature wall behind the kitchen island.",
    ],
  },
  {
    key: "luxe-minimal",
    name_en: "Luxe Minimal",
    name_ar: "الفاخر البسيط",
    one_line:
      "Book-matched stone, museum lighting, no visible hardware.",
    cost_delta_aed: 140_000,
    palette: ["#F5F2ED", "#4A3F35", "#C9A66B", "#2A2826"],
    reference_images: imagesFor("luxe-minimal"),
    what_changes: [
      "Book-matched stone slabs replace tiled walls in every wet room.",
      "Concealed cabinetry — push-to-open everywhere, no visible handles.",
      "Recessed museum-style lighting on continuous tracks, no exposed fixtures.",
    ],
  },
];

export function getStyleByKey(key: string): Style | undefined {
  return STYLES.find((s) => s.key === key);
}

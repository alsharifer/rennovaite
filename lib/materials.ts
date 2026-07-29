// Hardcoded material palette used by the AI Design Studio right column.
// Swatches are SELF-HOSTED under public/materials/ (no external CDN) so they
// never break: photographic textures where we had stable sources, and
// generated material-tone chips (.svg) for the rest. The alternates per
// material drive the swap modal — all client-state only, no persistence yet.

export type Material = {
  id: string;
  name: string;
  source: string; // vendor / supplier line
  unit_label: string; // e.g. "AED 95/m²"
  swatch_url: string;
  alternates: Array<{
    id: string;
    name: string;
    source: string;
    unit_label: string;
    swatch_url: string;
  }>;
};

export const MATERIALS: Material[] = [
  {
    id: "walnut-american",
    name: "American Walnut",
    source: "Danube Home",
    unit_label: "AED 95/m²",
    swatch_url:
      "/materials/walnut-american.svg",
    alternates: [
      {
        id: "walnut-canaletto",
        name: "Canaletto Walnut",
        source: "BRKZ",
        unit_label: "AED 128/m²",
        swatch_url:
          "/materials/walnut-canaletto.jpg",
      },
      {
        id: "walnut-fumed",
        name: "Fumed Walnut",
        source: "Saint-Gobain",
        unit_label: "AED 142/m²",
        swatch_url:
          "/materials/walnut-fumed.jpg",
      },
      {
        id: "walnut-quarter-sawn",
        name: "Quarter-sawn Walnut",
        source: "IKEA UAE",
        unit_label: "AED 84/m²",
        swatch_url:
          "/materials/walnut-quarter-sawn.svg",
      },
    ],
  },
  {
    id: "stone-travertine",
    name: "Silver Travertine",
    source: "RAK Ceramics",
    unit_label: "AED 188/m²",
    swatch_url:
      "/materials/stone-travertine.jpg",
    alternates: [
      {
        id: "stone-marble",
        name: "Ebony Marble",
        source: "RAK Ceramics",
        unit_label: "AED 245/m²",
        swatch_url:
          "/materials/stone-marble.jpg",
      },
      {
        id: "stone-concrete",
        name: "Raw Concrete",
        source: "Danube Home",
        unit_label: "AED 96/m²",
        swatch_url:
          "/materials/stone-concrete.jpg",
      },
      {
        id: "stone-terrazzo",
        name: "Terrazzo Crema",
        source: "Indian Milano",
        unit_label: "AED 165/m²",
        swatch_url:
          "/materials/stone-terrazzo.jpg",
      },
    ],
  },
  {
    id: "metal-brass",
    name: "Satin Brass",
    source: "KLUDI RAK",
    unit_label: "AED 410/lm",
    swatch_url:
      "/materials/metal-brass.svg",
    alternates: [
      {
        id: "metal-brushed-bronze",
        name: "Brushed Bronze",
        source: "BRKZ",
        unit_label: "AED 380/lm",
        swatch_url:
          "/materials/metal-brushed-bronze.svg",
      },
      {
        id: "metal-blackened-steel",
        name: "Blackened Steel",
        source: "Saint-Gobain",
        unit_label: "AED 295/lm",
        swatch_url:
          "/materials/metal-blackened-steel.jpg",
      },
      {
        id: "metal-matte-black",
        name: "Matte Black Aluminium",
        source: "IKEA UAE",
        unit_label: "AED 145/lm",
        swatch_url:
          "/materials/metal-matte-black.svg",
      },
    ],
  },
  {
    id: "textile-oatmeal",
    name: "Oatmeal Linen",
    source: "Home Centre",
    unit_label: "AED 130/m²",
    swatch_url:
      "/materials/textile-oatmeal.jpg",
    alternates: [
      {
        id: "textile-white-oak",
        name: "White Oak Veneer",
        source: "BRKZ",
        unit_label: "AED 88/m²",
        swatch_url:
          "/materials/textile-white-oak.jpg",
      },
      {
        id: "textile-bone",
        name: "Bone Boucle",
        source: "Home Centre",
        unit_label: "AED 195/m²",
        swatch_url:
          "/materials/textile-bone.jpg",
      },
      {
        id: "textile-sand-canvas",
        name: "Sand Canvas",
        source: "IKEA UAE",
        unit_label: "AED 72/m²",
        swatch_url:
          "/materials/textile-sand-canvas.jpg",
      },
    ],
  },
];

// Editorial "surface specs" panel shown beneath the materials list. Static
// values — these aren't tied to the chosen palette in v1.
export const SURFACE_SPECS: Array<{ label: string; value: string }> = [
  { label: "Reflectivity", value: "0.42" },
  { label: "Roughness", value: "0.08" },
  { label: "Opacity", value: "100%" },
  { label: "Anisotropy", value: "Off" },
];

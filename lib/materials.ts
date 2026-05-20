// Hardcoded material palette used by the AI Design Studio right column.
// Swatches are stable Unsplash CDN URLs picked per the B6 spec queries
// (ebony marble, walnut, raw concrete, white oak, terrazzo, brass). The
// alternates per material drive the swap modal — all client-state only,
// no persistence yet.

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
      "https://images.unsplash.com/photo-1502780402662-acc01917cf6d?auto=format&fit=crop&w=256&q=70",
    alternates: [
      {
        id: "walnut-canaletto",
        name: "Canaletto Walnut",
        source: "BRKZ",
        unit_label: "AED 128/m²",
        swatch_url:
          "https://images.unsplash.com/photo-1542728928-1413d1894ed1?auto=format&fit=crop&w=256&q=70",
      },
      {
        id: "walnut-fumed",
        name: "Fumed Walnut",
        source: "Saint-Gobain",
        unit_label: "AED 142/m²",
        swatch_url:
          "https://images.unsplash.com/photo-1488462237308-ecaa28b729d7?auto=format&fit=crop&w=256&q=70",
      },
      {
        id: "walnut-quarter-sawn",
        name: "Quarter-sawn Walnut",
        source: "IKEA UAE",
        unit_label: "AED 84/m²",
        swatch_url:
          "https://images.unsplash.com/photo-1567619169037-aef79ff32820?auto=format&fit=crop&w=256&q=70",
      },
    ],
  },
  {
    id: "stone-travertine",
    name: "Silver Travertine",
    source: "RAK Ceramics",
    unit_label: "AED 188/m²",
    swatch_url:
      "https://images.unsplash.com/photo-1615875605825-5eb9bb5d52ac?auto=format&fit=crop&w=256&q=70",
    alternates: [
      {
        id: "stone-marble",
        name: "Ebony Marble",
        source: "RAK Ceramics",
        unit_label: "AED 245/m²",
        swatch_url:
          "https://images.unsplash.com/photo-1518733057094-95b53143d2a7?auto=format&fit=crop&w=256&q=70",
      },
      {
        id: "stone-concrete",
        name: "Raw Concrete",
        source: "Danube Home",
        unit_label: "AED 96/m²",
        swatch_url:
          "https://images.unsplash.com/photo-1517411032315-54ef2cb783bb?auto=format&fit=crop&w=256&q=70",
      },
      {
        id: "stone-terrazzo",
        name: "Terrazzo Crema",
        source: "Indian Milano",
        unit_label: "AED 165/m²",
        swatch_url:
          "https://images.unsplash.com/photo-1599420186946-7b6fb4e297f0?auto=format&fit=crop&w=256&q=70",
      },
    ],
  },
  {
    id: "metal-brass",
    name: "Satin Brass",
    source: "KLUDI RAK",
    unit_label: "AED 410/lm",
    swatch_url:
      "https://images.unsplash.com/photo-1518306727298-4c17e1bf6947?auto=format&fit=crop&w=256&q=70",
    alternates: [
      {
        id: "metal-brushed-bronze",
        name: "Brushed Bronze",
        source: "BRKZ",
        unit_label: "AED 380/lm",
        swatch_url:
          "https://images.unsplash.com/photo-1551733018-08e7a8e3ad04?auto=format&fit=crop&w=256&q=70",
      },
      {
        id: "metal-blackened-steel",
        name: "Blackened Steel",
        source: "Saint-Gobain",
        unit_label: "AED 295/lm",
        swatch_url:
          "https://images.unsplash.com/photo-1495555687398-3f50d6e79e1e?auto=format&fit=crop&w=256&q=70",
      },
      {
        id: "metal-matte-black",
        name: "Matte Black Aluminium",
        source: "IKEA UAE",
        unit_label: "AED 145/lm",
        swatch_url:
          "https://images.unsplash.com/photo-1516234666763-f1a1d4f08e7d?auto=format&fit=crop&w=256&q=70",
      },
    ],
  },
  {
    id: "textile-oatmeal",
    name: "Oatmeal Linen",
    source: "Home Centre",
    unit_label: "AED 130/m²",
    swatch_url:
      "https://images.unsplash.com/photo-1503602642458-232111445657?auto=format&fit=crop&w=256&q=70",
    alternates: [
      {
        id: "textile-white-oak",
        name: "White Oak Veneer",
        source: "BRKZ",
        unit_label: "AED 88/m²",
        swatch_url:
          "https://images.unsplash.com/photo-1517164850305-99a3e65bb47e?auto=format&fit=crop&w=256&q=70",
      },
      {
        id: "textile-bone",
        name: "Bone Boucle",
        source: "Home Centre",
        unit_label: "AED 195/m²",
        swatch_url:
          "https://images.unsplash.com/photo-1554475901-4538ddfbccc2?auto=format&fit=crop&w=256&q=70",
      },
      {
        id: "textile-sand-canvas",
        name: "Sand Canvas",
        source: "IKEA UAE",
        unit_label: "AED 72/m²",
        swatch_url:
          "https://images.unsplash.com/photo-1530538095376-a4936b35b5f0?auto=format&fit=crop&w=256&q=70",
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

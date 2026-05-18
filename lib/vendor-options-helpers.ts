// Shared helpers used by both /api/vendor-options and the
// /project/[id]/vendors page. Kept tiny so the page can compute the same
// "is this a material line?" answer without round-tripping through the API.

export const ALL_RELEVANT_CATEGORIES = [
  "Tiles",
  "Sanitaryware",
  "Bathware",
  "Bathroom Furniture",
  "Bathroom Accessories",
  "Faucets & Mixers",
  "Kitchen",
  "Lighting",
  "Paint & Supplies",
  "Electrical",
  "Drywall & Ceilings",
  "Stone & Slabs",
  "Hardware",
  "Building Materials",
  "HVAC",
] as const;

// Returns the pricing_skus categories worth searching for this BoQ line.
// Returns [] for labour-only, custom-made, or non-product lines.
export function categoriesForLine(
  workSection: string,
  description: string,
): string[] {
  const d = description.toLowerCase();

  if (d.includes("labour only") || d.includes("labour-only")) return [];
  if (
    d.includes("rewire") ||
    d.includes("permit") ||
    d.includes("skip hire") ||
    d.includes("site setup") ||
    d.includes("preliminaries") ||
    d.includes("welfare") ||
    d.includes("waste disposal")
  ) {
    return [];
  }

  switch (workSection) {
    case "Floor Finishes":
      if (d.includes("tile") || d.includes("porcelain")) return ["Tiles"];
      if (d.includes("stone") || d.includes("marble"))
        return ["Stone & Slabs", "Tiles"];
      if (d.includes("wood") || d.includes("oak"))
        return ["Building Materials"];
      return [];

    case "Wall Finishes":
      if (d.includes("tile")) return ["Tiles"];
      if (d.includes("stone") || d.includes("marble"))
        return ["Stone & Slabs", "Tiles"];
      if (d.includes("mirror") || d.includes("glass")) return ["Hardware"];
      if (d.includes("panel")) return ["Building Materials"];
      return [];

    case "Sanitaryware":
      return [
        "Sanitaryware",
        "Bathware",
        "Bathroom Accessories",
        "Bathroom Furniture",
        "Faucets & Mixers",
      ];

    case "Joinery & Carpentry":
      if (d.includes("door") && !d.includes("sliding")) return ["Hardware"];
      return [];

    case "Electrical":
      if (d.includes("downlight") || d.includes("led"))
        return ["Lighting", "Electrical"];
      if (d.includes("socket") || d.includes("switch")) return ["Electrical"];
      return [];

    case "Lighting":
      return ["Lighting"];

    case "Decoration & Painting":
      if (
        d.includes("paint") &&
        (d.includes("material") ||
          d.includes("primer") ||
          d.includes("tin") ||
          d.includes("18l"))
      ) {
        return ["Paint & Supplies"];
      }
      return [];

    case "MEP / HVAC":
      if (
        d.includes("fcu") ||
        d.includes("split") ||
        d.includes("ac") ||
        d.includes("air condition")
      ) {
        return ["HVAC"];
      }
      return [];

    case "Plumbing":
    case "Demolition":
    case "Blockwork":
    case "Plaster":
    case "Preliminaries":
      return [];

    default:
      return [];
  }
}

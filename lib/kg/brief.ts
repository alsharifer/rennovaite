/**
 * Brief resolver — maps the app's UI/DB state onto the KG's slug IDs.
 *
 * The seeded KG slice is a single deliberate vertical: Arabian Ranches ×
 * Minimalist × villa-type-3-saheel. So this resolver can only ground the app's
 * style keys that have a sensible nearest-neighbour in that slice. Anything
 * unmapped returns `null`, and the caller treats `null` as "no KG grounding,
 * proceed exactly as before."
 */
import type { Brief } from "@/kg/retrieval/agent";

/**
 * App style key → KG style slug. The seeded slice only contains
 * `style:minimalist`, so the two warm/minimal-adjacent app styles map onto it
 * as the nearest available direction. Every other app style is intentionally
 * absent — `resolveBrief` returns null for those so the demo falls back to the
 * un-grounded path.
 */
const STYLE_KEY_TO_KG_SLUG: Record<string, string> = {
  "contemporary-majlis": "style:minimalist",
  "modern-hijazi": "style:minimalist",
  // coastal-emirati, scandi-arabic, andalusian-heritage, luxe-minimal:
  // unmapped until the KG seed grows beyond the single Minimalist slice.
};

// The seeded slice's community + property typology. These are hardcoded
// defaults rather than derived from the project record.
// TODO: community and propertyType should come from the project record once
// the KG seed covers the Mudon Al Naseem villa (currently the only seeded
// slice is Arabian Ranches × villa-type-3-saheel).
const DEFAULT_COMMUNITY = "community:arabian-ranches";
const DEFAULT_PROPERTY_TYPE = "property:villa-type-3-saheel";
const DEFAULT_BUDGET_TIERS = ["premium", "luxury"];

type ProjectLike = {
  id?: string | null;
  name?: string | null;
  city?: string | null;
} | null;

export function resolveBrief({
  styleKey,
  project,
}: {
  styleKey: string | null | undefined;
  project: ProjectLike;
}): Brief | null {
  if (!styleKey) return null;
  const style = STYLE_KEY_TO_KG_SLUG[styleKey];
  if (!style) return null;

  // `project` is accepted now so callers don't change later, but until the seed
  // covers the Mudon villa the community/propertyType are fixed to the seeded
  // slice regardless of the project record.
  void project;

  return {
    community: DEFAULT_COMMUNITY,
    style,
    propertyType: DEFAULT_PROPERTY_TYPE,
    budgetTiers: DEFAULT_BUDGET_TIERS,
  };
}

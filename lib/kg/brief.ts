/**
 * Brief resolver — maps the app's UI/DB state onto the KG's slug IDs.
 *
 * The seeded KG now covers the canonical demo: Mudon Al Naseem × the six app
 * styles × the 4BR first-floor villa. Every app style key has a 1:1 KG style,
 * so grounding lights up for all six directions. Unknown keys still return
 * `null`, and the caller treats `null` as "no KG grounding, proceed as before."
 */
import type { Brief } from "@/kg/retrieval/agent";

/**
 * App style key (lib/styles.ts) → KG style slug. Five styles map to their own
 * seeded KG nodes; `luxe-minimal` maps to the original `style:minimalist` node
 * (the minimalist-family direction), so all six app styles are grounded.
 */
const STYLE_KEY_TO_KG_SLUG: Record<string, string> = {
  "contemporary-majlis": "style:contemporary-majlis",
  "modern-hijazi": "style:modern-hijazi",
  "coastal-emirati": "style:coastal-emirati",
  "scandi-arabic": "style:scandi-arabic",
  "andalusian-heritage": "style:andalusian-heritage",
  "luxe-minimal": "style:minimalist",
};

// The canonical demo slice: the Mudon Al Naseem 4BR first-floor refit. These
// are fixed defaults rather than derived from the project record (the seed only
// covers this one community/property today).
const DEFAULT_COMMUNITY = "community:mudon-al-naseem";
const DEFAULT_PROPERTY_TYPE = "property:villa-mudon-4br-first-floor";
// Include "mid": the realistic UAE source tier for sanitaryware (RAK) and
// secondary-bedroom furniture (Home Centre) is mid, so the bathroom and
// secondary-bedroom spaces only return fixtures when "mid" is in scope. This
// matches the KG module's own example.ts brief.
const DEFAULT_BUDGET_TIERS = ["mid", "premium", "luxury"];

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

  // `project` is accepted so callers don't change when community/propertyType
  // later become per-project; today the seed covers a single slice, so they are
  // fixed to the Mudon demo regardless of the project record.
  void project;

  return {
    community: DEFAULT_COMMUNITY,
    style,
    propertyType: DEFAULT_PROPERTY_TYPE,
    budgetTiers: DEFAULT_BUDGET_TIERS,
  };
}

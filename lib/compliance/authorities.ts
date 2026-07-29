// =============================================================================
// lib/compliance/authorities.ts — community → authority routing (P6).
//
// Which authority governs a project's permits depends on the community. There
// is no `community` column on projects yet, so we derive it from the project
// name/city via keyword match, defaulting to Dubai Municipality. Entries we
// haven't confirmed with a consultant are flagged `confirmed: false`.
// =============================================================================

export type Authority = "DM" | "DDA" | "Trakhees" | "community_developer";
export type MunicipalAuthority = "DM" | "DDA" | "Trakhees";

export interface CommunityAuthority {
  community: string;
  /** Permit authority for the community's land. */
  municipal: MunicipalAuthority;
  /** Community developer whose NOC is typically required. */
  developer: string;
  keywords: string[];
  /** false → routing still needs consultant confirmation. */
  confirmed: boolean;
}

// Routing bands:
//   DM       — Dubai Municipality (default; most DM-land freehold/leasehold)
//   DDA      — Dubai Development Authority (TECOM master communities)
//   Trakhees — PCFC/Trakhees (Nakheel freezone: Palm, Discovery Gardens, JAFZA)
export const COMMUNITY_AUTHORITIES: CommunityAuthority[] = [
  // Mudon is Dubai Properties land under Dubai Municipality.
  { community: "Mudon", municipal: "DM", developer: "Dubai Properties", keywords: ["mudon"], confirmed: false }, // TODO: confirm with consultant
  // DDA (Dubai Development Authority) master communities.
  { community: "Jumeirah Lakes Towers", municipal: "DDA", developer: "DMCC", keywords: ["jlt", "jumeirah lakes"], confirmed: false }, // TODO: confirm with consultant
  { community: "Business Bay", municipal: "DDA", developer: "Dubai Properties", keywords: ["business bay"], confirmed: false }, // TODO: confirm with consultant
  { community: "Dubai Production City", municipal: "DDA", developer: "TECOM", keywords: ["production city", "impz"], confirmed: false }, // TODO: confirm with consultant
  // Trakhees (Nakheel freezone communities).
  { community: "Palm Jumeirah", municipal: "Trakhees", developer: "Nakheel", keywords: ["palm jumeirah", "palm "], confirmed: false }, // TODO: confirm with consultant
  { community: "Discovery Gardens", municipal: "Trakhees", developer: "Nakheel", keywords: ["discovery gardens"], confirmed: false }, // TODO: confirm with consultant
  { community: "Jebel Ali", municipal: "Trakhees", developer: "Nakheel", keywords: ["jebel ali", "jafza"], confirmed: false }, // TODO: confirm with consultant
];

export function resolveCommunity(project: {
  name?: string | null;
  city?: string | null;
}): CommunityAuthority {
  const hay = `${project.name ?? ""} ${project.city ?? ""}`.toLowerCase();
  for (const ca of COMMUNITY_AUTHORITIES) {
    if (ca.keywords.some((k) => hay.includes(k))) return ca;
  }
  // Default: Dubai Municipality, developer unknown.
  return {
    community: project.city?.trim() || "Dubai",
    municipal: "DM",
    developer: "your community developer",
    keywords: [],
    confirmed: false,
  };
}

/** Resolve a rule's municipal placeholder ('DM') to the community's actual authority. */
export function resolveAuthority(
  ruleAuthority: Authority,
  community: CommunityAuthority,
): Authority {
  return ruleAuthority === "DM" ? community.municipal : ruleAuthority;
}

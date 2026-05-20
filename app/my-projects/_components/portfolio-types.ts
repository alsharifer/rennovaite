// Shared types between the /my-projects server page and the client browser.

export type Phase =
  | "Active"
  | "Design"
  | "BoQ"
  | "Bidding"
  | "In Construction"
  | "Handover"
  | "On hold"
  | "Completed";

// Used by the "Furthest in pipeline" sort.
export const PHASE_ORDER: Phase[] = [
  "Active",
  "Design",
  "BoQ",
  "Bidding",
  "In Construction",
  "Handover",
  "Completed",
  "On hold",
];

// Filter chip set (display order). Drives the chips and the counts record.
export const ALL_PHASES: Phase[] = [
  "Active",
  "Design",
  "BoQ",
  "Bidding",
  "In Construction",
  "Handover",
  "On hold",
  "Completed",
];

export type SortKey = "updated" | "budget" | "pipeline" | "name";

export type PortfolioProject = {
  id: string;
  name: string;
  city: string | null;
  budget_aed: number | null;
  phase: Phase;
  hero_url: string | null;
  boq_total_aed: number | null;
  last_updated_at: string | null;
  created_at: string | null;
};

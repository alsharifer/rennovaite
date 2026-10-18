// =============================================================================
// lib/boq/rate-basis.ts — the basis of a line's rate, in the words the B5 brief
// and a QS use (bathroom pilot B5). Pure and client-safe.
//
//   calibrated  a figure transacted on the reference villa (Mudon / Villa 94):
//               the ground-truth joinery (GT/joinery), the sanitaryware
//               supplier's accessories (R-40–R-43), the reference project's
//               ceiling, cove, civil and stair rates (R-30, R-31, R-35, R-36, R-44)
//   market      the market rate book: the labour book bands, the catalogue, the
//               take-off and point-rate constants, a calibrated reference row
//   allowance   a judgement figure pending the QS — rule allowances, S6-pre
//               indicatives, site-assessment allowances
//   tbc         no rate in any book — a visible line at 0 ("to be priced")
//   firm        the project's firm's own book (tiers 1–2)
// =============================================================================

import { isFirmTier } from "@/lib/rates/tiers";

export type RateBasis = "calibrated" | "market" | "allowance" | "tbc" | "firm";

export const RATE_BASIS_LABEL: Record<RateBasis, string> = {
  calibrated: "calibrated (reference villa)",
  market: "market rate book",
  allowance: "allowance",
  tbc: "to be priced",
  firm: "your rate book",
};

const CALIBRATED_RULES = new Set(["R-30", "R-31", "R-35", "R-36", "R-40", "R-41", "R-42", "R-43", "R-44"]);

interface LineLike {
  rule_id?: string | null;
  rate_aed?: number | null;
  rate_status?: string | null;
  rate_tier?: string | null;
}

export function rateBasisOf(line: LineLike): RateBasis {
  if (line.rate_status === "needs_qs" && (line.rate_aed ?? 0) === 0) return "tbc";
  if (line.rate_tier && isFirmTier(line.rate_tier as never)) return "firm";
  const rule = line.rule_id ?? "";
  if (rule.startsWith("GT/")) return line.rate_status === "actual_transaction" ? "calibrated" : "allowance";
  const r = rule.match(/R-\d+/)?.[0];
  if (r && CALIBRATED_RULES.has(r)) return "calibrated";
  if (line.rate_tier === "allowance" || line.rate_tier === "indicative" || line.rate_status === "site_assessment" || line.rate_status === "indicative") return "allowance";
  return "market";
}

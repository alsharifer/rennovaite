// =============================================================================
// lib/provenance/tier-vocab.ts — the five provenance marks (R7 §1.4, K1).
//
// The vocabulary every Blueprint figure speaks: which mark a figure carries,
// how the marks rank (R1 weakest link), and the words for them — firm and
// owner. Client-safe on purpose: the marks are computed on the server by
// tierOf() (lib/provenance/tier.ts, which reaches the I4 provenance module and
// therefore identity curation) and travel to the browser as data. A component
// imports THIS file, never tier.ts.
// =============================================================================

export const PROV_TIERS = ["measured", "validated", "market", "derived", "unpriced"] as const;
export type ProvTier = (typeof PROV_TIERS)[number];
/** A tier that prices — unpriced lines never take part in a weakest-link (R1). */
export type PricedTier = Exclude<ProvTier, "unpriced">;

/** R1 order, strongest first: measured > validated > market > derived. */
const RANK: Record<PricedTier, number> = { measured: 0, validated: 1, market: 2, derived: 3 };

export function weaker(a: PricedTier, b: PricedTier): PricedTier {
  return RANK[a] >= RANK[b] ? a : b;
}

/**
 * The weakest COUNTED tier (a section subtotal, the counted subtotal, the
 * headline). Unpriced inputs are skipped; all-unpriced is "unpriced"; nothing
 * at all is null.
 */
export function weakest(tiers: readonly ProvTier[]): ProvTier | null {
  const counted = tiers.filter((t): t is PricedTier => t !== "unpriced");
  if (counted.length === 0) return tiers.length > 0 ? "unpriced" : null;
  return counted.reduce(weaker);
}

/** One BoQ line's marks: quantity = geometry tier, rate = rate tier, amount = the weaker (R1). */
export interface LineTiers {
  qty: ProvTier;
  rate: ProvTier;
  amount: ProvTier;
  /** For a "Derived (+ which)" label: why each figure is derived, in plain words. */
  qtyWhy: string | null;
  rateWhy: string | null;
}

export type Persona = "firm" | "owner";
export type FigureRole = "qty" | "rate" | "amount";

/**
 * The label beside a mark (spec §1.4). Firm vocabulary distinguishes a firm's
 * own rate ("Own basis") from measured geometry ("Measured"); the owner sees
 * plainer words.
 */
export function tierLabel(tier: ProvTier, persona: Persona = "firm", role: FigureRole = "amount"): string {
  if (persona === "owner") {
    return { measured: "Measured", validated: "Checked", market: "Market reference", derived: "Estimated", unpriced: "To be priced" }[tier];
  }
  if (tier === "measured") return role === "rate" ? "Own basis" : "Measured";
  return { validated: "QS validated", market: "Market reference", derived: "Derived", unpriced: "To be priced" }[tier];
}

/**
 * The owner Overview's "What this number is based on" rows (K8, spec §6.2,
 * Figma 54:145) — the same marks in the owner's words.
 */
export const OWNER_BASIS_LABEL: Record<ProvTier, string> = {
  measured: "Measured from your plan",
  validated: "Checked by a quantity surveyor",
  market: "Market price — recent Dubai jobs",
  derived: "Estimated — confirm before tender",
  unpriced: "Not priced yet — excluded",
};

/** "Derived — site assessment" for a firm; the plain label otherwise. */
export function tierLabelWithWhy(tier: ProvTier, why: string | null, persona: Persona = "firm", role: FigureRole = "amount"): string {
  const label = tierLabel(tier, persona, role);
  return tier === "derived" && why && persona === "firm" ? `${label} — ${why}` : label;
}

/**
 * The accessible description of a figure (spec §4.2 #1): the visible number,
 * its tier, and — for an amount — what it took from its inputs:
 * "7,329.70, derived — quantity derived, rate market reference".
 */
export function describeFigure(text: string, tier: ProvTier, opts: { persona?: Persona; role?: FigureRole; inputs?: Pick<LineTiers, "qty" | "rate"> } = {}): string {
  const persona = opts.persona ?? "firm";
  const head = `${text}, ${tierLabel(tier, persona, opts.role ?? "amount").toLowerCase()}`;
  if (!opts.inputs || tier === "unpriced") return head;
  const q = tierLabel(opts.inputs.qty, persona, "qty").toLowerCase();
  const r = tierLabel(opts.inputs.rate, persona, "rate").toLowerCase();
  return `${head} — quantity ${q}, rate ${r}`;
}

// =============================================================================
// lib/identity/curation.ts — which names may reach BoQ text (I4).
//
// POLICY. A SOURCE CONTRACTOR's identity never surfaces: not in a BoQ line, a
// popover, a PDF, an API response or a what-if payload. That covers
// `rate_book.source`, `rate_book.internal_ref`, the firm name behind a private
// rate book, and rule notes derived from a specific contractor's pricing.
// Product and vendor BRAND names that are genuine specifications (a catalogue
// SKU's vendor, "GROHE", a client-supplied grill brand) remain — a client needs
// them to know what is being bought.
//
// Two layers:
//   1. SOURCE: the modules that emitted contractor names now emit role labels
//      ("joinery reference quotation"), so new BoQs are clean at birth.
//   2. READ: `curateBoq` runs over every stored BoQ on its way to a user, because
//      documents generated before I4 still hold the old strings.
//
// AMBIGUOUS names are NOT scrubbed here — they are listed, with their route into
// the BoQ, for a human ruling (AMBIGUOUS_NAMES). Deciding them unilaterally
// would either leak a contractor or delete a specification.
// =============================================================================

import { INTERNAL_REF } from "@/lib/ground-truth/villa94-garden";

interface Withheld {
  pattern: RegExp;
  replacement: string;
  /** Why this is a contractor identity rather than a brand. */
  why: string;
}

/** Longest patterns first: a full name + reference must be replaced as one. */
export const WITHHELD_IDENTITIES: readonly Withheld[] = [
  { pattern: new RegExp(INTERNAL_REF.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), replacement: "landscape reference contract", why: "garden contractor (internal_ref)" },
  { pattern: /KAME Landscape (?:&|and) Pools/gi, replacement: "landscape reference contractor", why: "garden contractor (internal_ref)" },
  { pattern: /\bKAME\b/g, replacement: "landscape reference contractor", why: "garden contractor (internal_ref)" },
  { pattern: /Atrium Technical Services(?: QTN\d+)?/gi, replacement: "joinery reference quotation", why: "Mudon joinery contractor (rate_book.source, joinery rule notes)" },
  { pattern: /\bAtrium (?=\d)/g, replacement: "ref ", why: "Mudon joinery contractor line refs, e.g. '(Atrium 1.1)'" },
  { pattern: /\bQTN20261407\b/g, replacement: "joinery reference quotation", why: "Mudon joinery quotation number" },
  { pattern: /Global Creation(?: Services)?(?: ref 3936\/R1)?/gi, replacement: "aluminium & glazing reference quotation", why: "Mudon aluminium contractor (rate_book.source, R-43 note)" },
  { pattern: /\b3936\/R1\b/g, replacement: "aluminium reference quotation", why: "Mudon aluminium quotation number" },
];

/**
 * Names that reach BoQ text today and need a human ruling. NOT scrubbed.
 * Each entry says exactly how the name gets in.
 */
export const AMBIGUOUS_NAMES: readonly { name: string; route: string; question: string }[] = [
  {
    name: "Laspinas",
    route: "RATE_RULES R-40…R-43 allowance_note (lib/boq/rules.ts) → engine line notes, Mudon Sanitaryware (shattaf, paper holder, towel rail, actuator); also Mudon rate_book.source (prod only, never selected)",
    question: "Sanitaryware supplier whose quotation (46703) priced the accessories — contractor-pricing source (scrub) or the retailer a client buys from (keep)? Pending Abdallah's ruling.",
  },
  {
    name: "Villa 94",
    route: "RATE_RULES R-30 / R-35 / R-36 allowance_note and take-off Q-20 measurement → engine line notes on every interior BoQ",
    question: "It is Mudon's own villa number — harmless on Mudon's BoQ, but it names another client's project on anyone else's. The garden reference pack already asserts no house number.",
  },
  {
    name: "RAK",
    route: "pricing_skus.vendor 'RAK Ceramics' → catalogue-tier vendor_or_source (kept: a brand/specification); the S6-05 vanity-slab line's source 'excluded from the RAK tiles quotation' (lib/boq/joinery-aluminum.ts → Mudon Joinery); 'RAK cart 0000160602' in Mudon rate_book.source (prod only, never selected)",
    question: "The catalogue vendor is a specification and stays. Confirm the cart reference is never needed on a document.",
  },
  {
    name: "Newspace",
    route: "firms.name (normalised from boq_corrections.attributed_to) — never on a BoQ line (firm rates carry 'contractor rate book'); code comments only in lib/boq",
    question: "Firm identity — withheld by construction; listed so the firms table is a known source of names.",
  },
];

/** Replace every withheld contractor identity in a string. Extra names (e.g. firm names) are withheld too. */
export function curateText(s: string, extraNames: readonly string[] = []): string {
  let out = s;
  for (const w of WITHHELD_IDENTITIES) out = out.replace(w.pattern, w.replacement);
  for (const name of extraNames) {
    const n = name.trim();
    if (n.length < 3) continue;
    out = out.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "contractor");
  }
  return out;
}

/** Deep-curate every string in a stored BoQ (or any JSON payload) on its way to a user. */
export function curateBoq<T>(value: T, extraNames: readonly string[] = []): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return curateText(v, extraNames);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

/** Every withheld identity still present in a payload — the leak assertion's core. */
export function findWithheldIdentities(payload: unknown, extraNames: readonly string[] = []): string[] {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  const hits = new Set<string>();
  for (const w of WITHHELD_IDENTITIES) {
    const m = text.match(new RegExp(w.pattern.source, w.pattern.flags.includes("i") ? "i" : ""));
    if (m) hits.add(m[0]);
  }
  for (const name of extraNames) if (name.trim().length >= 3 && text.toLowerCase().includes(name.trim().toLowerCase())) hits.add(name);
  return [...hits];
}

/**
 * The firm names to withhold (server). A firm's name lives in `firms` and must
 * never reach a document; read-time curation withholds it wherever it appears.
 */
export async function loadWithheldNames(sb: { from: (t: string) => { select: (c: string) => PromiseLike<{ data: unknown; error: unknown }> } }): Promise<string[]> {
  try {
    const { data, error } = await sb.from("firms").select("name");
    if (error || !Array.isArray(data)) return [];
    return (data as { name: unknown }[]).map((r) => String(r.name ?? "")).filter((n) => n.trim().length >= 3);
  } catch {
    return [];
  }
}

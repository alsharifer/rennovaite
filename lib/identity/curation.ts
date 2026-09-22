// =============================================================================
// lib/identity/curation.ts — which names may reach BoQ text (I4, T3b).
//
// POLICY. A SOURCE CONTRACTOR's or SUPPLIER's identity never surfaces: not in a
// BoQ line, a popover, a drawing, a pack, a PDF, an API response or a what-if
// payload. That covers `rate_book.source`, `rate_book.internal_ref`, rule notes
// derived from a specific contractor's or supplier's pricing, and the address
// of a reference project. Product and vendor BRAND names that are genuine
// specifications (a catalogue SKU's vendor, "GROHE", a client-supplied grill
// brand) remain — a client needs them to know what is being bought.
//
// FIRMS. A firm's name may appear only on that firm's OWN projects' surfaces
// (`projects.firm_id`). Every other firm in `firms` is withheld. The rule is
// generic (`withheldFirmNames` / `loadWithheldNames`) — never a special case for
// one firm.
//
// Two layers:
//   1. SOURCE: modules that emitted identities now emit role labels
//      ("joinery reference quotation", "sanitaryware supplier",
//      "reference project"), so new documents are clean at birth.
//   2. READ: `curateBoq` / `curateText` run over stored text on its way to a
//      user, because documents and DB rows written earlier still hold the old
//      strings.
//
// SERVER-ONLY: this module holds the names it withholds. A test walks every
// client component's import graph to prove none reaches it.
// =============================================================================

import { INTERNAL_REF } from "@/lib/ground-truth/villa94-garden";

interface Withheld {
  pattern: RegExp;
  replacement: string;
  /** Why this is an identity rather than a brand. */
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
  // T3b rulings (2026-09-22).
  { pattern: /Laspinas(?: quotation)?(?: 46703)?(?:,? line [0-9A-Z]+)?/gi, replacement: "sanitaryware supplier", why: "supplier whose quotation priced R-40–R-43 (ruled: withhold)" },
  { pattern: /\b46703\b/g, replacement: "supplier quotation", why: "the sanitaryware supplier's quotation number" },
  { pattern: /\b(?:Mudon )?Villa ?94\b/gi, replacement: "reference project", why: "ties both reference projects to an identifiable property (ruled: withhold)" },
  { pattern: /\bV94\b/g, replacement: "reference project", why: "abbreviation of the reference property" },
  { pattern: /the RAK tiles quotation/gi, replacement: "the client-supplied tile package", why: "named the tile supplier's quotation (ruled); RAK as a catalogue brand stays" },
];

/**
 * The rulings on names that reached BoQ text (T3b). Recorded so the next name
 * that turns up has precedent — and so a reviewer can see what was decided.
 */
export const NAME_RULINGS: readonly { name: string; ruling: "withheld" | "kept"; route: string; why: string }[] = [
  { name: "Laspinas", ruling: "withheld", route: "R-40…R-43 notes, the sanitary take-off notes, the accessory catalogue seed, the what-if grade specs", why: "A supplier whose pricing fed the rules — same treatment as a source contractor → 'sanitaryware supplier'." },
  { name: "Villa 94", ruling: "withheld", route: "R-30 / R-35 / R-36 notes, the Q-20 take-off note, the timeline basis, reference-project names", why: "Ties both reference projects to an identifiable property → 'reference project'." },
  { name: "RAK (tiles quotation)", ruling: "withheld", route: "the S6-05 vanity-slab line and the R-46 note", why: "Named the tile supplier's quotation → 'the client-supplied tile package'." },
  { name: "RAK Ceramics", ruling: "kept", route: "pricing_skus.vendor → catalogue-tier vendor_or_source", why: "A catalogue brand is a specification." },
  { name: "firm names (firms.name)", ruling: "withheld", route: "zone / run / context derived notes, correction attribution, any stored text", why: "Allowed only on that firm's own projects (projects.firm_id); withheld everywhere else." },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replace every withheld identity in a string. Extra names (firm names) are withheld too. */
export function curateText(s: string, extraNames: readonly string[] = []): string {
  let out = s;
  for (const w of WITHHELD_IDENTITIES) out = out.replace(w.pattern, w.replacement);
  for (const name of extraNames) {
    const n = name.trim();
    if (n.length < 3) continue;
    out = out.replace(new RegExp(`\\b${escape(n)}\\b`, "gi"), "contractor");
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
  for (const name of extraNames) {
    if (name.trim().length >= 3 && new RegExp(`\\b${escape(name.trim())}\\b`, "i").test(text)) hits.add(name);
  }
  return [...hits];
}

/**
 * PURE: the firm names to withhold on a project's surfaces — every firm except
 * the project's own. A firm may see its own name on its own project; no other
 * project's document may carry it.
 */
export function withheldFirmNames(firms: readonly { id: string; name: string }[], projectFirmId: string | null): string[] {
  return firms
    .filter((f) => f.id !== projectFirmId)
    .map((f) => String(f.name ?? ""))
    .filter((n) => n.trim().length >= 3);
}

type Db = import("@supabase/supabase-js").SupabaseClient;

/**
 * The firm names to withhold on `projectId`'s surfaces (server). `projectId` is
 * REQUIRED — every caller must say whose surface it renders. `null` (a surface
 * that belongs to no project) withholds every firm.
 */
export async function loadWithheldNames(sb: unknown, projectId: string | null): Promise<string[]> {
  const db = sb as Db;
  try {
    const [firms, project] = await Promise.all([
      db.from("firms").select("id, name"),
      projectId
        ? db.from("projects").select("firm_id").eq("id", projectId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (firms.error || !Array.isArray(firms.data)) return [];
    const own = (project.data as { firm_id?: string | null } | null)?.firm_id ?? null;
    return withheldFirmNames(firms.data as { id: string; name: string }[], own);
  } catch {
    return [];
  }
}

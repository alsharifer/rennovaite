// =============================================================================
// lib/provenance/boq.ts — the source chain for every figure on a BoQ (I4).
//
// Pure. Given a STORED BoQ document (any vintage — a pre-L1 BoQ has no
// `rate_tier`, so the tier is inferred from the line's rule id and band) and the
// plan context (element names, derived flags, rate-book QS flags), it returns a
// FigureProvenance for every figure the BoQ view shows:
//
//   line quantity  ← plan geometry: the zones / runs / fixtures it was measured
//                    from, or the take-off rule's derivation; derived flags
//   line rate      ← resolution tier (Private / market_fair / actual_transaction
//                    / Fallback / Indicative / QS to price), a CURATED source
//                    label, and QS validation
//   line total     ← qty × rate, checked
//   section total  ← Σ lines, checked
//   subtotal / OH&P / contingency / VAT / grand total ← the shared chain
//                    (lib/boq/totals.ts), checked against what is stored
//
// Every string passes `curateText` — a contractor identity cannot reach a
// popover even from a BoQ stored before I4. A figure whose source cannot be
// established is NOT given a plausible story: it is marked untraceable with the
// reason, and listed in `findings`.
// =============================================================================

import { UNPRICED_GARDEN_ITEMS, UNPRICED_SOURCE_LABEL } from "@/lib/boq/garden-takeoff";
import { RATE_RULES } from "@/lib/boq/rules";
import { chainTotals } from "@/lib/boq/totals";
import { GARDEN_RATES, PUBLIC_SOURCE_LABEL } from "@/lib/ground-truth/villa94-garden";
import { curateText } from "@/lib/identity/curation";
import { DERIVED_QTY_NOTE } from "@/lib/plan/site-reference";
import { formatAed } from "@/lib/format/aed";

import type { BoqProvenance, ChainStep, FigureProvenance, LineProvenance } from "./types";

// --- Inputs ------------------------------------------------------------------

export interface ProvLine {
  description: string;
  quantity: number;
  unit: string;
  rate_aed: number;
  total_aed: number;
  vendor_or_source: string;
  notes: string | null;
  rule_id?: string;
  kind?: string;
  rate_band?: string;
  rate_status?: string;
  rate_tier?: string;
  qty_derived?: boolean;
  element_refs?: string[] | null;
}

export interface ProvBoq {
  sections: { work_section: string; lines: ProvLine[]; section_total_aed: number }[];
  subtotal_aed: number;
  contingency_pct: number;
  contingency_aed: number;
  vat_pct: number;
  vat_aed: number;
  grand_total_aed: number;
  ohp_pct?: number;
  ohp_aed?: number;
  engine?: { tier?: string } | null;
}

export interface ProvElement {
  name: string;
  kind: string;
  derived: boolean;
  derived_note: string | null;
}

export interface ProvenanceContext {
  /** element id → what it is on the plan (zones, runs, fixtures, context). */
  elements: Record<string, ProvElement>;
  /** item_key → QS validation of its rate_book rows (only the boolean is ever read). */
  qsValidated: Record<string, boolean>;
  /** Names withheld in every string (firm names from `firms`). */
  withheldNames: string[];
}

export const EMPTY_CONTEXT: ProvenanceContext = { elements: {}, qsValidated: {}, withheldNames: [] };

// --- Tier vocabulary (the popover's words) ------------------------------------

interface TierDisplay {
  name: string;
  detail: string;
  /** How the QS line reads for this tier when no rate_book flag applies. */
  qs: string;
}

export const TIER_DISPLAY: Record<string, TierDisplay> = {
  firm_private: { name: "Private", detail: "The contractor's own rate book — shadows the market reference for this project only.", qs: "Contractor's own rate — not QS-reviewed by the platform." },
  firm_correction: { name: "market_fair", detail: "A market_fair correction by this project's contractor, explicitly promoted into its rate book.", qs: "A reviewed correction — not a QS validation." },
  reference: { name: "actual_transaction", detail: "Calibrated market reference — a rate actually paid on a comparable Dubai project.", qs: "QS validation not recorded." },
  module_reference: { name: "actual_transaction", detail: "Transacted reference rates from the Mudon ground-truth quotations, held in code (lib/ground-truth).", qs: "Not QS-validated (qs_validated = false on every transacted row)." },
  catalog: { name: "Fallback — catalogue", detail: "No book rate: a Dubai supplier-catalogue price picked at the style's tier.", qs: "Catalogue price — no QS validation on record." },
  allowance: { name: "Fallback — rule allowance", detail: "No book or catalogue rate: the take-off rule's allowance.", qs: "Allowance — QS to confirm." },
  labour_book: { name: "Fallback — labour rate book", detail: "A market labour band for the style's tier.", qs: "Market labour band — no QS validation on record." },
  p4_constant: { name: "Fallback — take-off constant", detail: "A representative mid-tier rate held as a constant in the element take-off (lib/boq/elements.ts). It does not pass through the rate resolver, so a contractor's private rate does not apply to it.", qs: "Constant — no QS validation on record." },
  overlay_default: { name: "Fallback — default point rate", detail: "The default per-point rate for a fixture drawn on the services overlay.", qs: "Default rate — no QS validation on record." },
  indicative: { name: "Indicative", detail: "A placeholder or judgement rate — not a transaction. Pending review.", qs: "Indicative — not QS-validated." },
  furniture: { name: "Indicative", detail: "Indicative Dubai retail for staged furniture. Optional; never in contractor scope.", qs: "Indicative — not QS-validated." },
  unpriced: { name: "QS to price", detail: "No rate exists for this work in any book — a visible line at 0, never an invented price.", qs: "Awaiting the QS." },
  selection: { name: "Selected product", detail: "A specific product chosen for this line, laid over the resolved rate.", qs: "" },
};

const STATUS_FLAG: Record<string, string> = {
  needs_qs: "QS to price",
  site_assessment: "site assessment",
  needs_selection: "awaiting a selection",
  indicative: "indicative",
};

// --- Keys --------------------------------------------------------------------

const RULE_ITEM = new Map<string, string>(Object.entries(RATE_RULES).map(([k, r]) => [r.rule_id, k]));
const GARDEN_LABEL_ITEM = new Map<string, string>([
  ...GARDEN_RATES.map((g) => [g.label, g.item_key] as const),
  ...Object.entries(UNPRICED_GARDEN_ITEMS).map(([k, v]) => [v.label, k] as const),
]);

/** The rate-book item key behind a stored line, when one can be named. */
export function lineItemKey(line: ProvLine): string | null {
  const rule = line.rule_id ?? "";
  const r = rule.split("/").find((p) => /^R-\d+/.test(p));
  if (r && RULE_ITEM.has(r)) return RULE_ITEM.get(r)!;
  if (rule.startsWith("GL-")) return GARDEN_LABEL_ITEM.get(line.description) ?? null;
  if (rule.startsWith("P4/quantify/")) return rule.slice("P4/quantify/".length);
  return null;
}

/** Which tier answered — stored `rate_tier`, or inferred for a BoQ stored before L1. */
export function lineTierKey(line: ProvLine, workSection: string): string | null {
  if (line.rate_tier) return line.rate_tier;
  const rule = line.rule_id ?? "";
  if (workSection === "Furniture (optional)") return "furniture";
  if (rule.startsWith("P4/quantify/")) return "p4_constant";
  if (rule.startsWith("P2/overlay/")) return line.rate_status === "needs_qs" ? "unpriced" : "overlay_default";
  if (rule.startsWith("GT/")) return "module_reference";
  if (rule.startsWith("GL-")) {
    if (line.vendor_or_source === UNPRICED_SOURCE_LABEL) return "unpriced";
    if (line.vendor_or_source === PUBLIC_SOURCE_LABEL) return "reference";
    return null;
  }
  if (/^(Q|S6)-/.test(rule)) {
    if (line.rate_band === "allowance") return "allowance";
    if (line.rate_band === "sku") return line.kind === "material" ? "catalog" : "selection";
    if (line.rate_band === "low" || line.rate_band === "mid" || line.rate_band === "high") return "labour_book";
    if (line.rate_band === "book") return null; // a book tier always stores rate_tier
    // S6-pre components assembled in lib/boq/joinery-aluminum.ts carry no band —
    // only the status they were stamped with.
    if (!line.rate_band && line.rate_status === "indicative") return "indicative";
    if (!line.rate_band && line.rate_status === "site_assessment") return "allowance";
    if (!line.rate_band && line.rate_status === "actual_transaction") return "module_reference";
  }
  return null;
}

// --- Builders ----------------------------------------------------------------

const fmtQty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

function splitNotes(line: ProvLine): { basis: string | null; takeoff: string | null } {
  const notes = line.notes?.trim() || null;
  if (!notes) return { basis: null, takeoff: null };
  // Engine lines (they carry a rate_band) are `${rate note}; ${take-off}`. Lines
  // assembled elsewhere (joinery/aluminium, S6-pre components) note the take-off only.
  if (line.rate_band && /^(Q|S6)-/.test(line.rule_id ?? "")) {
    const i = notes.lastIndexOf("; ");
    if (i > 0) return { basis: notes.slice(0, i), takeoff: notes.slice(i + 2) };
    return { basis: notes, takeoff: null };
  }
  return { basis: null, takeoff: notes };
}

function lineProvenance(line: ProvLine, workSection: string, ctx: ProvenanceContext, figureRef: string): LineProvenance & { gaps: string[] } {
  const cur = (s: string) => curateText(s, ctx.withheldNames);
  const gaps: string[] = [];
  const flags = new Set<string>();

  // ---- geometry → quantity
  const qSteps: ChainStep[] = [];
  const { basis, takeoff } = splitNotes(line);
  const refs = line.element_refs ?? [];
  if (refs.length > 0) {
    const named = refs.map((id) => ctx.elements[id]);
    const known = named.filter(Boolean) as ProvElement[];
    const detail = refs
      .map((id) => {
        const e = ctx.elements[id];
        return e ? `${cur(e.name)} (${e.kind})${e.derived ? " — derived" : ""}` : `element ${id.slice(0, 8)} — no longer on the plan`;
      })
      .join(" · ");
    qSteps.push({ kind: "geometry", label: `Measured from ${refs.length} plan element${refs.length === 1 ? "" : "s"}`, detail });
    for (const e of known) {
      if (e.derived) flags.add("derived dimensions");
      if (e.derived_note && /sized to measured aggregate/i.test(e.derived_note)) flags.add("sized to measured aggregate");
      if (e.derived_note) qSteps.push({ kind: "flag", label: `${cur(e.name)}`, detail: cur(e.derived_note) });
    }
    if (known.length < refs.length) flags.add("element missing from plan");
  }
  if (takeoff) qSteps.push({ kind: "rule", label: "Take-off", detail: cur(takeoff) });
  if (line.rule_id) qSteps.push({ kind: "rule", label: "Rule", detail: line.rule_id });
  const lump = (line.unit === "project" || line.unit === "lump") && refs.length === 0;
  if (lump && !takeoff) qSteps.push({ kind: "geometry", label: "Project lump", detail: "Priced per project — not measured from a plan element." });
  if (line.qty_derived) flags.add(line.notes?.includes(DERIVED_QTY_NOTE) ? "derived from reference layout" : "quantity inferred");
  const qTraceable = refs.length > 0 || !!takeoff || lump;
  if (!qTraceable) gaps.push(`${figureRef} quantity: no plan element, take-off derivation or rule on the line`);

  // ---- tier → rate
  const tierKey = lineTierKey(line, workSection);
  const tier = tierKey ? TIER_DISPLAY[tierKey] : undefined;
  const rSteps: ChainStep[] = [];
  if (tier) rSteps.push({ kind: "tier", label: tier.name, detail: tier.detail });
  else gaps.push(`${figureRef} rate: resolution tier cannot be established (rule ${line.rule_id ?? "none"}, band ${line.rate_band ?? "none"})`);
  if (line.vendor_or_source) rSteps.push({ kind: "source", label: "Source", detail: cur(line.vendor_or_source) });
  if (basis) rSteps.push({ kind: "rule", label: "Rate basis", detail: cur(basis) });
  const itemKey = lineItemKey(line);
  let qs = tier?.qs ?? "";
  if (itemKey && (tierKey === "reference" || tierKey === "indicative") && itemKey in ctx.qsValidated) {
    qs = ctx.qsValidated[itemKey] ? "QS-validated: yes (rate book)." : "QS-validated: no (rate book).";
  }
  if (tierKey === "selection") qs = line.rate_status === "priced" ? "QS-validated product: yes." : "QS-validated product: no — QS to confirm.";
  if (qs) rSteps.push({ kind: "qs", label: "QS validation", detail: qs });
  if (line.rate_status && STATUS_FLAG[line.rate_status]) flags.add(STATUS_FLAG[line.rate_status]!);
  if (tierKey === "p4_constant") flags.add("constant rate");

  // ---- total = qty × rate
  const expect = line.quantity * line.rate_aed;
  const off = Math.abs(expect - line.total_aed);
  const tSteps: ChainStep[] = [
    { kind: "arith", label: "Quantity × rate", detail: `${fmtQty(line.quantity)} ${line.unit} × ${formatAed(line.rate_aed, "rate")} = ${formatAed(expect, "rate")} → stored ${formatAed(line.total_aed, "rate")}` },
  ];
  if (tier) tSteps.push({ kind: "tier", label: "Rate tier", detail: tier.name });
  if (qSteps[0]) tSteps.push({ ...qSteps[0] });
  const tolerance = Math.max(1, Math.abs(line.total_aed) * 0.005);
  if (off > tolerance) {
    flags.add("total ≠ quantity × rate");
    gaps.push(`${figureRef} total: stored ${line.total_aed} differs from quantity × rate (${expect.toFixed(2)}) by ${off.toFixed(2)}`);
  }

  const flagList = [...flags];
  const title = cur(line.description);
  const qGap = gaps.find((g) => g.includes("quantity"));
  const rGap = gaps.find((g) => g.includes("rate:"));
  const tGap = gaps.find((g) => g.includes("total:"));
  return {
    quantity: { title: `Quantity — ${title}`, steps: qSteps, flags: flagList, traceable: !qGap, ...(qGap ? { gap: qGap } : {}) },
    rate: { title: `Rate — ${title}`, steps: rSteps, flags: flagList, traceable: !rGap, ...(rGap ? { gap: rGap } : {}) },
    total: {
      title: `Total — ${title}`,
      steps: tSteps,
      flags: flagList,
      traceable: !qGap && !rGap && !tGap,
      ...(qGap || rGap || tGap ? { gap: [qGap, rGap, tGap].filter(Boolean).join("; ") } : {}),
    },
    gaps,
  };
}

function checked(title: string, steps: ChainStep[], stored: number, computed: number, what: string, findings: BoqProvenance["findings"]): FigureProvenance {
  const off = Math.abs(stored - computed);
  if (off > 1) {
    const gap = `${what}: stored ${formatAed(stored)} but the chain gives ${formatAed(computed)} (off by ${off.toFixed(2)})`;
    findings.push({ figure: title, gap });
    return { title, steps, flags: ["does not reconcile"], traceable: false, gap };
  }
  return { title, steps, flags: [], traceable: true };
}

/** Provenance for every figure of a stored BoQ. */
export function buildBoqProvenance(boq: ProvBoq, ctx: ProvenanceContext = EMPTY_CONTEXT): BoqProvenance {
  const findings: BoqProvenance["findings"] = [];
  const lines: BoqProvenance["lines"] = {};
  const sections: BoqProvenance["sections"] = {};

  for (const s of boq.sections) {
    s.lines.forEach((l, idx) => {
      const key = `${s.work_section}-${idx}`;
      const p = lineProvenance(l, s.work_section, ctx, `${s.work_section} line ${idx + 1} (${curateText(l.description, ctx.withheldNames)})`);
      for (const g of p.gaps) findings.push({ figure: key, gap: g });
      lines[key] = { quantity: p.quantity, rate: p.rate, total: p.total };
    });
    const sum = s.lines.reduce((a, l) => a + l.total_aed, 0);
    sections[s.work_section] = checked(
      `Section total — ${s.work_section}`,
      [{ kind: "arith", label: `Σ ${s.lines.length} line${s.lines.length === 1 ? "" : "s"}`, detail: `${formatAed(sum)} (POMI work section; each line's own popover carries its source)` }],
      s.section_total_aed,
      sum,
      `Section ${s.work_section}`,
      findings,
    );
  }

  const sectionSum = boq.sections.reduce((a, s) => a + s.section_total_aed, 0);
  const chain = chainTotals({ subtotal_aed: boq.subtotal_aed, contingency_pct: boq.contingency_pct, vat_pct: boq.vat_pct, ohp_pct: boq.ohp_pct });
  const subtotal = checked(
    "Subtotal",
    [{ kind: "arith", label: `Σ ${boq.sections.length} work sections`, detail: formatAed(sectionSum) }],
    boq.subtotal_aed,
    sectionSum,
    "Subtotal",
    findings,
  );
  const ohp =
    boq.ohp_aed && boq.ohp_aed > 0
      ? checked(
          `Overheads & profit ${boq.ohp_pct}%`,
          [
            { kind: "tier", label: "Private", detail: "The contractor's OH&P setting, applied once at assembly — never inside a rate." },
            { kind: "arith", label: `${boq.ohp_pct}% of subtotal`, detail: `${boq.ohp_pct}% × ${formatAed(boq.subtotal_aed)} = ${formatAed(chain.ohp_aed)}` },
          ],
          boq.ohp_aed,
          chain.ohp_aed,
          "OH&P",
          findings,
        )
      : null;
  const contingencyBase = boq.subtotal_aed + chain.ohp_aed;
  const contingency = checked(
    `Contingency ${boq.contingency_pct}%`,
    [{ kind: "arith", label: `${boq.contingency_pct}% of ${chain.ohp_aed ? "subtotal + OH&P" : "subtotal"}`, detail: `${boq.contingency_pct}% × ${formatAed(contingencyBase)} = ${formatAed(chain.contingency_aed)}` }],
    boq.contingency_aed,
    chain.contingency_aed,
    "Contingency",
    findings,
  );
  const vatBase = contingencyBase + chain.contingency_aed;
  const vat = checked(
    `VAT ${boq.vat_pct}%`,
    [{ kind: "arith", label: `${boq.vat_pct}% of everything above`, detail: `${boq.vat_pct}% × ${formatAed(vatBase)} = ${formatAed(chain.vat_aed)}` }],
    boq.vat_aed,
    chain.vat_aed,
    "VAT",
    findings,
  );
  const grand = checked(
    "Project total",
    [
      {
        kind: "arith",
        label: "Subtotal + OH&P + contingency + VAT",
        detail: `${formatAed(boq.subtotal_aed)}${chain.ohp_aed ? ` + ${formatAed(chain.ohp_aed)}` : ""} + ${formatAed(chain.contingency_aed)} + ${formatAed(chain.vat_aed)} = ${formatAed(chain.grand_total_aed)}`,
      },
    ],
    boq.grand_total_aed,
    chain.grand_total_aed,
    "Grand total",
    findings,
  );

  return { lines, sections, summary: { subtotal, ohp, contingency, vat, grand }, findings };
}

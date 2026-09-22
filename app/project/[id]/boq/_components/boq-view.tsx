"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Figure, FigureProvenanceProvider } from "@/components/figures/Figure";
import { boqDerivedInfo, derivedLineNote, derivedTotal } from "@/lib/documents/boq-derived";
import { formatAed } from "@/lib/format/aed";
import type { BoqProvenance, FigureProvenance, LineProvenance } from "@/lib/provenance/types";
import { OHP_LINE_LABEL } from "@/lib/rates/ohp";
import { cn } from "@/lib/utils";
import {
  recalc,
  suggestForBudget,
  type RateBook,
  type ScenarioBoq,
  type Selections,
} from "@/lib/whatif/engine";
import { findComponentDuplicates } from "@/lib/boq/component-dedupe";
import { itemKeyFromRuleId, type Grade, type GradeableItem } from "@/lib/whatif/grades";
import type { FurnitureSection } from "@/lib/staging/furniture-boq";

import { WhatIfSidebar, type WhatIfRow } from "./whatif-sidebar";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BoqLine = {
  description: string;
  quantity: number;
  unit: string;
  rate_aed: number;
  total_aed: number;
  vendor_or_source: string;
  notes: string | null;
  // P2 additive: overlay-derived lines carry element refs + a rate status.
  // P7 adds "indicative" for furniture; ground-truth adds "actual_transaction"
  // (priced from a real contract/quote) and "site_assessment" (allowance only).
  element_refs?: string[] | null;
  rate_status?:
    | "priced"
    | "needs_qs"
    | "indicative"
    | "actual_transaction"
    | "site_assessment"
    | "needs_selection";
  /** G3: the quantity was inferred, not measured off the drawing. */
  qty_derived?: boolean;
  // P4/P5: engine rule id (P4/quantify/<key> marks a gradeable line).
  rule_id?: string;
  /** L1: which tier of the resolution order answered. */
  rate_tier?: string;
};

export type BoqSection = {
  work_section: string;
  lines: BoqLine[];
  section_total_aed: number;
};

export type BoqPayload = {
  sections: BoqSection[];
  subtotal_aed: number;
  contingency_pct: number;
  contingency_aed: number;
  vat_pct: number;
  vat_aed: number;
  grand_total_aed: number;
  /** L1: the firm's overheads & profit — its own line, never inside a rate. */
  ohp_pct?: number;
  ohp_aed?: number;
  /** G5: a garden BoQ's verdict on itself (draft, derived lines, site-reference decisions). */
  garden?: {
    draft: { draft: boolean; derived: string[]; note: string | null; statement: string | null };
    derived_lines: number;
    removals: { element_id: string; name: string; qty: number; unit: string; disposition: string }[];
    kept: { element_id: string; name: string }[];
    undecided: { element_id: string; name: string }[];
    needs_selection: string[];
  };
  /** G5d: an indicative delivery programme — never a line, never a commitment. */
  programme?: { total_days: number; phases: { name: string; start_day: number; days: number }[]; basis: string } | null;
};

export type VendorOption = {
  id: string;
  sku: string | null;
  brand: string | null;
  description: string | null;
  photo_url: string | null;
  price_aed: number;
  lead_time_days: number | null;
  in_stock: boolean | null;
};

export type RoomRollupView = {
  roomId: string;
  roomName: string;
  total_aed: number;
  items: { description: string; qty: number; unit: string; total_aed: number }[];
};

type Props = {
  projectId: string;
  budgetAed: number;
  boq: BoqPayload;
  lineOptions: Record<string, VendorOption[]>;
  byRoom?: RoomRollupView[];
  initialView?: "sections" | "byroom";
  highlightRef?: string | null;
  highlightRoom?: string | null;
  // P5 what-if: enabled only when the BoQ has takeoff provenance.
  whatifEnabled?: boolean;
  rateBook?: RateBook | null;
  initialSelections?: Selections;
  // P7: optional indicative furniture section (separate from boq.sections so it
  // never reaches a contractor export). Toggleable from the what-if panel.
  furnitureSection?: FurnitureSection | null;
  /** I4: the source chain behind every figure, built on the server from the stored BoQ + plan. */
  provenance?: BoqProvenance | null;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BRASS_TINTS = [
  "#7A5518", // primary
  "#966D2F", // primary-container
  "#A4793A", // brass-600
  "#C9A66B", // mid tone
  "#F1BE78", // primary-fixed-dim
] as const;

type Sensitivity = { description: string; delta_aed: number };

const SENSITIVITY_TOGGLES = [
  { id: "premium", label: "Premium materials", pct: 15 },
  { id: "local-labour", label: "Local labour sourcing", pct: -8 },
  { id: "tight", label: "Tight schedule (60 days)", pct: 6 },
  { id: "phased", label: "Phase the work (2 phases)", pct: -3 },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmtQty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** A figure the browser computes from stored ones — its chain is built here, from the same numbers. */
function computedProvenance(title: string, steps: FigureProvenance["steps"], flags: string[] = []): FigureProvenance {
  return { title, steps, flags, traceable: true };
}

function sectionRef(work_section: string, idx: number): string {
  // Section prefix: first letters of each capitalised word, up to 4 chars.
  const initials = work_section
    .split(/[\s&/]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join("")
    .slice(0, 4);
  return `${initials}-${String(idx + 1).padStart(2, "0")}`;
}

function sensitivityFor(
  workSection: string,
  line: BoqLine,
): Sensitivity | null {
  const desc = line.description.toLowerCase();
  if (workSection === "Floor Finishes" && desc.includes("porcelain")) {
    return {
      description:
        "Upgrading to engineered European oak (180mm wide, brushed matt) adds AED 18,400.",
      delta_aed: 18400,
    };
  }
  if (workSection === "Floor Finishes" && desc.includes("screed")) {
    return {
      description:
        "Upgrading to a self-levelling polymer screed (acoustic-rated) adds AED 4,200.",
      delta_aed: 4200,
    };
  }
  if (workSection === "Wall Finishes") {
    return {
      description:
        "Upgrading to large-format marble-effect porcelain (60×120, rectified) adds AED 6,600.",
      delta_aed: 6600,
    };
  }
  if (workSection === "Sanitaryware") {
    return {
      description:
        "Upgrading the set to Duravit + Hansgrohe (matt black) adds AED 14,500 per bathroom.",
      delta_aed: 14500,
    };
  }
  if (workSection === "Joinery & Carpentry" && desc.includes("wardrobe")) {
    return {
      description:
        "Upgrading wardrobe carcass to smoked oak veneer with soft-close push-to-open adds AED 11,800 per bedroom.",
      delta_aed: 11800,
    };
  }
  if (workSection === "Joinery & Carpentry" && desc.includes("door")) {
    return {
      description:
        "Upgrading from flush MDF to engineered solid-core oak doors adds AED 1,900 per door.",
      delta_aed: 1900,
    };
  }
  if (workSection === "Joinery & Carpentry" && desc.includes("vanity")) {
    return {
      description:
        "Upgrading the vanity top to honed Calacatta marble adds AED 3,400 per bathroom.",
      delta_aed: 3400,
    };
  }
  if (workSection === "Lighting") {
    return {
      description:
        "Adding 4 designer pendants (Flos / Foscarini) plus DALI dimming adds AED 12,200.",
      delta_aed: 12200,
    };
  }
  if (
    workSection === "Decoration & Painting" &&
    (desc.includes("painting") || desc.includes("walls"))
  ) {
    return {
      description:
        "Upgrading to a hand-applied lime wash on living-area walls adds AED 7,800.",
      delta_aed: 7800,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------

export function BoqView({
  projectId,
  budgetAed,
  boq,
  lineOptions,
  byRoom = [],
  initialView = "sections",
  highlightRef = null,
  highlightRoom = null,
  whatifEnabled = false,
  rateBook = null,
  initialSelections = {},
  furnitureSection = null,
  provenance = null,
}: Props) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // P7: furniture is included in the display total by default; toggling it off
  // (from the what-if panel or the section header) restores the prior total
  // exactly, since it is a single additive integer over the baseline.
  const furnitureTotal = furnitureSection?.section_total_aed ?? 0;
  const [furnitureOn, setFurnitureOn] = useState(true);
  const [activeToggles, setActiveToggles] = useState<Set<string>>(
    () => new Set(),
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [view, setView] = useState<"sections" | "byroom">(initialView);

  // --- P5 what-if scenario (over the locked baseline) ---
  const whatifOn = whatifEnabled && rateBook != null;
  const [selections, setSelections] = useState<Selections>(initialSelections);
  const scenarioBoq: ScenarioBoq = useMemo(
    () => ({
      grand_total_aed: boq.grand_total_aed,
      sections: boq.sections,
      // I4: with these, a scenario total is the shared chain over the moved
      // subtotal — the figure a regenerated BoQ would store.
      subtotal_aed: boq.subtotal_aed,
      contingency_pct: boq.contingency_pct,
      vat_pct: boq.vat_pct,
      ohp_pct: boq.ohp_pct,
    }),
    [boq],
  );
  const scenario = useMemo(
    () => (whatifOn && rateBook ? recalc(scenarioBoq, rateBook, selections) : null),
    [whatifOn, rateBook, scenarioBoq, selections],
  );
  const changedItems = useMemo(
    () => new Set(scenario?.changedItemKeys ?? []),
    [scenario],
  );
  const whatIfRows: WhatIfRow[] = useMemo(() => {
    if (!scenario || !rateBook) return [];
    return scenario.perChange
      .map((c) => ({
        item_key: c.item_key,
        label: c.label,
        qty: c.quantity,
        selected: c.grade,
        options: (["economy", "standard", "premium"] as Grade[]).map((g) => ({
          grade: g,
          rate: rateBook[c.item_key][g].rate_aed,
          delta: Math.round((rateBook[c.item_key][g].rate_aed - c.baseline_rate) * c.quantity),
          qs_validated: rateBook[c.item_key][g].qs_validated,
          spec: rateBook[c.item_key][g].spec,
          source: rateBook[c.item_key][g].source,
        })),
      }))
      .sort((a, b) => b.qty * b.options[1]!.rate - a.qty * a.options[1]!.rate);
  }, [scenario, rateBook]);

  // Persist the scenario (debounced) so it survives reload + is QS-shareable.
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!whatifOn || !scenario) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      void fetch("/api/whatif-scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, selections, total: scenario.total }),
      }).catch(() => {});
    }, 600);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [whatifOn, scenario, selections, projectId]);

  const selectGrade = (item: GradeableItem, grade: Grade) =>
    setSelections((cur) => ({ ...cur, [item]: grade }));
  const resetScenario = () => setSelections({});
  const applyBudget = (target: number) => {
    if (rateBook) setSelections(suggestForBudget(scenarioBoq, rateBook, target));
  };

  // Deep link ?highlight=REF → scroll the row into view + flash a brass ring.
  useEffect(() => {
    if (!highlightRef || view !== "sections") return;
    const el = document.getElementById(`boq-row-${highlightRef}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightRef, view]);

  const baseTotal = boq.grand_total_aed;

  const adjustments = useMemo(() => {
    let pct = 0;
    const changes: { label: string; pct: number }[] = [];
    for (const t of SENSITIVITY_TOGGLES) {
      if (activeToggles.has(t.id)) {
        pct += t.pct;
        changes.push({ label: t.label, pct: t.pct });
      }
    }
    return { pct, changes };
  }, [activeToggles]);

  // I4: with no toggle active the total IS the stored figure — rounding it here
  // turned AED 116,679.07 into 116,679 and printed a phantom "−AED 0" adjustment.
  const adjustedTotal =
    adjustments.pct === 0 ? baseTotal : Math.round(baseTotal * (1 + adjustments.pct / 100) * 100) / 100;
  const scopeTotal = whatifOn && scenario ? scenario.total : adjustedTotal;
  const furnitureIncluded = furnitureOn ? furnitureTotal : 0;
  const displayTotal = scopeTotal + furnitureIncluded;
  // G5: a total resting on derived quantities never prints as a bare number.
  const derivedInfo = boqDerivedInfo(boq);
  const totalFootnote = derivedTotal(displayTotal, derivedInfo).footnote;
  const headroom = budgetAed - displayTotal;

  // I4: the summary chain the table shows — the stored one, or the scenario's
  // (same arithmetic, lib/boq/totals.ts) when a what-if moved the subtotal.
  const chain = scenario?.chain && scenario.delta !== 0
    ? scenario.chain
    : {
        subtotal_aed: boq.subtotal_aed,
        ohp_pct: boq.ohp_pct ?? 0,
        ohp_aed: boq.ohp_aed ?? 0,
        contingency_pct: boq.contingency_pct,
        contingency_aed: boq.contingency_aed,
        vat_pct: boq.vat_pct,
        vat_aed: boq.vat_aed,
        grand_total_aed: boq.grand_total_aed,
      };
  const scenarioMoved = !!(scenario && scenario.delta !== 0);
  const sensitivityAed = whatifOn && scenario ? 0 : adjustedTotal - baseTotal;
  const summaryProv = provenance?.summary;
  const scenarioStep = (label: string, stored: number, now: number) => ({
    kind: "arith" as const,
    label,
    detail: `stored ${formatAed(stored)} → scenario ${formatAed(now)} (what-if grades moved the subtotal by ${formatAed(scenario?.delta ?? 0, "signed")}; recomputed with the stored percentages)`,
  });
  const adjusted = scenarioMoved || sensitivityAed !== 0 || furnitureIncluded > 0;
  const totalProv: FigureProvenance | null = !adjusted
    ? summaryProv?.grand ?? null
    : computedProvenance(
        "Project total — as displayed",
        [
          { kind: "arith", label: "Stored project total", detail: formatAed(baseTotal) },
          ...(scenarioMoved ? [scenarioStep("What-if scenario", baseTotal, chain.grand_total_aed)] : []),
          ...(sensitivityAed !== 0 ? [{ kind: "arith" as const, label: `Sensitivity ${adjustments.pct > 0 ? "+" : ""}${adjustments.pct}%`, detail: `${formatAed(sensitivityAed, "signed")} — an illustrative percentage of the total, not a priced change` }] : []),
          ...(furnitureIncluded > 0 ? [{ kind: "arith" as const, label: "Furniture (optional)", detail: `${formatAed(furnitureIncluded, "signed")} — indicative retail, never in contractor scope` }] : []),
          { kind: "arith", label: "Displayed", detail: formatAed(displayTotal) },
        ],
        ["not the stored figure"],
      );
  const budgetProv = computedProvenance("Your budget", [
    { kind: "source", label: "Project setting", detail: "The budget entered for this project (the platform default of AED 850,000 when none was entered)." },
  ]);
  const headroomProv = computedProvenance(headroom >= 0 ? "Headroom" : "Over budget", [
    { kind: "arith", label: "Budget − displayed total", detail: `${formatAed(budgetAed)} − ${formatAed(displayTotal)} = ${formatAed(headroom, "signed")}` },
  ]);
  const sensitivityProv = (label: string, amount: number) =>
    computedProvenance(label, [
      { kind: "arith", label: "Illustrative", detail: `${formatAed(amount, "signed")} — a fixed percentage of the stored total (${formatAed(baseTotal)}); not a priced change and never stored` },
    ], ["illustrative"]);

  // Top 5 sections by total for the stacked bar, with everything else
  // rolled into an "Other" bucket so the bar reads cleanly.
  const barSegments = useMemo(() => {
    const totals = boq.sections.map((s) => ({
      label: s.work_section,
      total: s.section_total_aed,
    }));
    totals.sort((a, b) => b.total - a.total);
    const top = totals.slice(0, 5);
    const rest = totals.slice(5);
    if (rest.length > 0) {
      const otherTotal = rest.reduce((sum, t) => sum + t.total, 0);
      // Replace the smallest of the top 5 with "Other" only if Other is
      // larger; otherwise keep the top 5 and drop the small remainder.
      top.push({ label: `Other (${rest.length})`, total: otherTotal });
    }
    const total = top.reduce((s, t) => s + t.total, 0) || 1;
    return top.slice(0, 5).map((t, i) => ({
      label: t.label,
      total: t.total,
      pct: Math.round((t.total / total) * 100),
      tint: BRASS_TINTS[i % BRASS_TINTS.length]!,
    }));
  }, [boq.sections]);

  // A component priced by two mechanisms at once is money charged twice. The
  // detector reports; it deliberately does NOT pick a winner, because which
  // line survives depends on what each rate is meant to cover — a QS judgement,
  // not a rendering one. Surfaced here so it is adjudicated in the open rather
  // than discovered in a contractor's markup.
  const duplicateFindings = useMemo(
    () =>
      findComponentDuplicates(
        boq.sections.flatMap((sec) =>
          sec.lines.map((l) => ({
            work_section: sec.work_section,
            description: l.description,
            rule_id: l.rule_id ?? null,
            item_key: null,
            quantity: l.quantity,
            total_aed: l.total_aed,
          })),
        ),
      ),
    [boq.sections],
  );

  return (
    <FigureProvenanceProvider>
      {/* DUPLICATE-COMPONENT NOTICE -------------------------------------- */}
      {duplicateFindings.length > 0 && (
        <section className="-mx-12 border-y border-[#E8C9A0] bg-[#FEF6EC] px-margin py-md">
          <div className="flex items-start gap-sm">
            <span
              className="material-symbols-outlined mt-0.5 shrink-0 text-[20px] text-[#A4793A]"
              aria-hidden="true"
            >
              content_copy
            </span>
            <div className="min-w-0">
              <p className="font-body text-body-sm font-semibold text-ink-900">
                {duplicateFindings.length === 1
                  ? "1 component is priced twice"
                  : `${duplicateFindings.length} components are priced twice`}{" "}
                — duplicate detected, pending QS scope ruling
              </p>
              <p className="mt-1 font-body text-body-sm text-ink-700">
                Each of these is charged by two different mechanisms in the same
                BoQ. Nothing has been removed automatically: which line survives
                depends on what each rate is meant to cover, and that is a QS
                decision.
              </p>
              <ul className="mt-sm space-y-1.5">
                {duplicateFindings.map((f) => (
                  <li
                    key={`${f.component}-${f.duplicate_key}`}
                    className="font-body text-body-sm text-ink-900"
                  >
                    <span className="font-semibold">{f.label}</span>
                    {" — "}
                    <span className="font-mono text-[12px]">{f.owner_key}</span>
                    {" in "}
                    {f.owner_line.work_section}
                    {" also priced as "}
                    <span className="font-mono text-[12px]">{f.duplicate_key}</span>
                    {" in "}
                    {f.duplicate_line.work_section}
                    {f.duplicate_total_aed > 0 ? (
                      <>
                        {" · "}
                        <Figure
                          className="font-mono"
                          value={f.duplicate_total_aed}
                          provenance={computedProvenance(`Duplicated — ${f.label}`, [
                            { kind: "arith", label: "Total of the duplicate line", detail: `${f.duplicate_key} in ${f.duplicate_line.work_section}` },
                          ], ["priced twice"])}
                        />
                        {" duplicated"}
                      </>
                    ) : (
                      <>
                        {" · "}
                        <span className="text-on-surface-variant">
                          AED 0 today (the duplicate line is unpriced — it costs
                          nothing only until someone prices it)
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* TOP SUMMARY BAND ----------------------------------------------- */}
      <section className="-mx-12 grid grid-cols-12 items-center gap-gutter border-y border-ink-100 bg-paper px-margin py-md">
        {/* Left: total + headroom */}
        <div className="col-span-12 flex flex-col gap-xs lg:col-span-3">
          <motion.h2
            key={displayTotal}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
            className="font-display text-headline-lg tabular-nums text-ink-900"
          >
            <Figure value={displayTotal} text={derivedTotal(displayTotal, derivedInfo).text} provenance={totalProv} />
          </motion.h2>
          {totalFootnote && (
            <p className="font-body-sm text-[12px] leading-4 text-[#9A3412]" data-derived-total="true">
              {totalFootnote}
            </p>
          )}
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            against your <Figure value={budgetAed} provenance={budgetProv} /> budget —{" "}
            <span
              className={cn(
                "font-semibold",
                headroom >= 0 ? "text-tertiary" : "text-error",
              )}
            >
              <Figure value={Math.abs(headroom)} provenance={headroomProv} />{" "}
              {headroom >= 0 ? "headroom" : "over"}
            </span>
            {adjustments.pct !== 0 && (
              <>
                {" "}
                ·{" "}
                <span className="text-ink-500">
                  base <Figure value={baseTotal} provenance={summaryProv?.grand ?? null} /> · adjusted{" "}
                  {adjustments.pct > 0 ? "+" : ""}
                  {adjustments.pct}%
                </span>
              </>
            )}
          </p>
        </div>

        {/* Center: stacked bar */}
        <div className="col-span-12 flex flex-col gap-xs lg:col-span-5">
          <div
            className="flex h-2 w-full overflow-hidden rounded-full"
            role="img"
            aria-label="Section share of total"
          >
            {barSegments.map((seg) => (
              <div
                key={seg.label}
                style={{
                  width: `${seg.pct}%`,
                  background: seg.tint,
                }}
                title={`${seg.label} — ${formatAed(seg.total)} (${seg.pct}%)`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-md gap-y-xs">
            {barSegments.map((seg) => (
              <div key={seg.label} className="flex items-center gap-xs">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-sm"
                  style={{ background: seg.tint }}
                />
                <span className="label-caps text-on-surface-variant">
                  {seg.label} · {seg.pct}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: actions */}
        <div className="col-span-12 flex items-center justify-end gap-md lg:col-span-4">
          {/* Icon-only at this density — "Export PDF" + "Continue to
              vendors" both with text was 390px in a 336px column. The
              icon is universally read; title attribute carries the
              label for screen readers and tooltips. */}
          {/* G5: a garden BoQ exports as a PDF (draft header, derived total). */}
          {boq.garden ? (
            <a
              href={`/api/projects/${projectId}/boq-pdf`}
              target="_blank"
              rel="noopener"
              title="Export PDF"
              aria-label="Export PDF"
              className="focus-ring flex size-12 items-center justify-center rounded-lg border border-ink-100 text-ink-900 transition-colors hover:bg-surface-container-low"
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                picture_as_pdf
              </span>
            </a>
          ) : (
          <button
            type="button"
            title="Export PDF"
            aria-label="Export PDF"
            className="focus-ring flex size-12 items-center justify-center rounded-lg border border-ink-100 text-ink-900 transition-colors hover:bg-surface-container-low"
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              picture_as_pdf
            </span>
          </button>
          )}
          <Link
            href={`/project/${projectId}/vendors`}
            className="focus-ring flex h-12 items-center gap-sm rounded-lg bg-brass-600 px-lg font-body-sm text-body-sm font-semibold text-on-primary transition-colors hover:bg-primary"
          >
            Continue to vendors
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              arrow_forward
            </span>
          </Link>
        </div>
      </section>

      {/* VIEW TOGGLE — POMI sections (default + export) vs By room (P4) --- */}
      {byRoom.length > 0 && (
        <div className="mt-xl inline-flex gap-0.5 rounded-lg border border-ink-100 bg-paper p-0.5">
          {(["sections", "byroom"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={cn(
                "focus-ring rounded-md px-3 py-1.5 text-body-sm font-semibold transition-colors",
                view === v ? "bg-brass-600 text-on-primary" : "text-ink-700 hover:bg-surface-container",
              )}
            >
              {v === "sections" ? "By section" : "By room"}
            </button>
          ))}
        </div>
      )}

      {boq.programme ? <ProgrammePanel programme={boq.programme} /> : null}
      {view === "byroom" ? (
        <ByRoomView byRoom={byRoom} highlightRoom={highlightRoom} />
      ) : (
      <>
      {/* TABLE + SIDEBAR ------------------------------------------------ */}
      <div
        className={cn(
          "mt-xl grid gap-gutter",
          sidebarOpen ? "lg:grid-cols-[1fr_320px]" : "lg:grid-cols-1",
        )}
      >
        {/* Main table */}
        <section className="overflow-hidden rounded-xl border border-ink-100 bg-paper">
          {/* table-fixed forces the col widths to honor the % hints below;
              without it, auto-layout starves the unconstrained
              description column when the table is narrow (e.g. 743px
              left column at 1440 with the sidebar open). */}
          <table className="w-full table-fixed text-left">
            {/* Description gets all leftover width. Numeric columns sized
                to the widest realistic AED amount; Source is wrapped to
                2 lines via the cell's line-clamp. Chevron column 48px
                fits the 32px button + 8px each side. */}
            <colgroup>
              <col className="w-[56px]" />
              <col />
              <col className="w-[52px]" />
              <col className="w-[56px]" />
              <col className="w-[80px]" />
              <col className="w-[96px]" />
              <col className="w-[112px]" />
              <col className="w-[48px]" />
            </colgroup>
            <thead>
              <tr className="border-b border-ink-100">
                <Th>Ref</Th>
                <Th>Line item description</Th>
                <Th>Unit</Th>
                <Th className="text-right">Qty</Th>
                <Th className="text-right">Rate (AED)</Th>
                <Th className="text-right">Total (AED)</Th>
                <Th>Source</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {boq.sections.map((section) => (
                <SectionGroup
                  key={section.work_section}
                  section={section}
                  expandedKey={expandedKey}
                  onToggle={(k) =>
                    setExpandedKey((cur) => (cur === k ? null : k))
                  }
                  lineOptions={lineOptions}
                  highlightRef={highlightRef}
                  changedItems={changedItems}
                  provenance={provenance}
                />
              ))}
              {/* I4: the same summary the PDF prints — screen and paper agree. */}
              <SummaryRow label="Subtotal" value={chain.subtotal_aed} provenance={scenarioMoved ? computedProvenance("Subtotal — scenario", [scenarioStep("Subtotal", boq.subtotal_aed, chain.subtotal_aed)], ["not the stored figure"]) : summaryProv?.subtotal ?? null} strong />
              {chain.ohp_aed > 0 && (
                <SummaryRow
                  label={`${OHP_LINE_LABEL} ${chain.ohp_pct}%`}
                  note="the contractor's markup, applied once here and never inside a rate"
                  value={chain.ohp_aed}
                  provenance={scenarioMoved ? computedProvenance("OH&P — scenario", [scenarioStep("OH&P", boq.ohp_aed ?? 0, chain.ohp_aed)], ["not the stored figure"]) : summaryProv?.ohp ?? null}
                  dataAttr="ohp"
                />
              )}
              <SummaryRow
                label={`Contingency ${chain.contingency_pct}%`}
                value={chain.contingency_aed}
                provenance={scenarioMoved ? computedProvenance("Contingency — scenario", [scenarioStep("Contingency", boq.contingency_aed, chain.contingency_aed)], ["not the stored figure"]) : summaryProv?.contingency ?? null}
              />
              <SummaryRow
                label={`VAT ${chain.vat_pct}%`}
                value={chain.vat_aed}
                provenance={scenarioMoved ? computedProvenance("VAT — scenario", [scenarioStep("VAT", boq.vat_aed, chain.vat_aed)], ["not the stored figure"]) : summaryProv?.vat ?? null}
              />
              {sensitivityAed !== 0 && (
                <SummaryRow label={`Sensitivity ${adjustments.pct > 0 ? "+" : ""}${adjustments.pct}%`} note="illustrative — not a priced change" value={sensitivityAed} format="signed" provenance={sensitivityProv("Sensitivity adjustment", sensitivityAed)} />
              )}
              {furnitureIncluded > 0 && (
                <SummaryRow label="Furniture (optional)" note="indicative retail — not in contractor scope" value={furnitureIncluded} format="signed" provenance={computedProvenance("Furniture (optional)", [{ kind: "tier", label: "Indicative", detail: "Indicative Dubai retail for staged furniture; the section below itemises it." }], ["indicative"])} />
              )}
              <tr className="border-t-2 border-ink-900">
                <td className="px-md py-md" colSpan={5}>
                  <span className="label-caps text-brass-600">
                    Project total
                  </span>
                </td>
                <td className="px-md py-md text-right">
                  <motion.span
                    key={displayTotal}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.24, ease: "easeOut" }}
                    className="inline-block font-display text-[24px] leading-none tabular-nums text-ink-900"
                    style={{
                      fontFamily: "var(--font-jetbrains-mono), monospace",
                    }}
                  >
                    <Figure value={displayTotal} text={derivedTotal(displayTotal, derivedInfo).text} provenance={totalProv} />
                  </motion.span>
                </td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </section>

        {/* Sidebar — WHAT IF (P5) when enabled, else cost sensitivity */}
        {sidebarOpen &&
          (whatifOn && scenario ? (
            <WhatIfSidebar
              rows={whatIfRows}
              baselineTotal={baseTotal}
              scenarioTotal={scenario.total}
              changed={changedItems.size > 0}
              onSelect={selectGrade}
              onReset={resetScenario}
              onBudget={applyBudget}
              onClose={() => setSidebarOpen(false)}
              furniture={
                furnitureSection
                  ? {
                      total: furnitureTotal,
                      on: furnitureOn,
                      onToggle: () => setFurnitureOn((v) => !v),
                    }
                  : null
              }
            />
          ) : (
          <aside className="flex flex-col gap-md rounded-xl border border-ink-100 bg-paper p-lg">
            <div className="flex items-center justify-between">
              <p className="label-caps text-ink-500">Cost sensitivity</p>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                aria-label="Collapse sensitivity panel"
                className="focus-ring flex size-7 items-center justify-center rounded text-on-surface-variant hover:text-ink-900"
              >
                <span className="material-symbols-outlined text-[18px]">
                  close
                </span>
              </button>
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Toggle assumptions to see live impacts on the BoQ totals.
            </p>

            <div className="flex flex-col gap-sm">
              {SENSITIVITY_TOGGLES.map((t) => {
                const active = activeToggles.has(t.id);
                const positive = t.pct > 0;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() =>
                      setActiveToggles((prev) => {
                        const next = new Set(prev);
                        if (next.has(t.id)) next.delete(t.id);
                        else next.add(t.id);
                        return next;
                      })
                    }
                    aria-pressed={active}
                    className={cn(
                      "focus-ring flex items-center justify-between rounded-lg border px-md py-sm text-left transition-colors",
                      active
                        ? "border-brass-600 bg-primary-fixed/40 text-ink-900"
                        : "border-ink-100 bg-paper text-ink-900 hover:bg-surface-container-low",
                    )}
                  >
                    <span className="font-body-sm text-body-sm font-semibold">
                      {t.label}
                    </span>
                    <span
                      className={cn(
                        "font-mono text-body-sm tabular-nums",
                        positive ? "text-error" : "text-tertiary",
                      )}
                    >
                      {positive ? "+" : "−"}
                      {Math.abs(t.pct)}%
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-md border-t border-bone pt-md">
              <p className="label-caps mb-sm text-ink-500">What changed</p>
              {adjustments.changes.length === 0 ? (
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  No modifiers active — total holds at{" "}
                  <Figure value={baseTotal} provenance={summaryProv?.grand ?? null} />.
                </p>
              ) : (
                <ul className="flex flex-col gap-sm">
                  {adjustments.changes.map((c) => (
                    <li
                      key={c.label}
                      className="font-body-sm text-body-sm text-on-surface-variant"
                    >
                      <span className="font-semibold text-ink-900">
                        {c.label}
                      </span>{" "}
                      ·{" "}
                      <span
                        className={cn(
                          "font-mono",
                          c.pct > 0 ? "text-error" : "text-tertiary",
                        )}
                      >
                        <Figure value={baseTotal * (c.pct / 100)} format="signed" provenance={sensitivityProv(c.label, baseTotal * (c.pct / 100))} />
                      </span>
                    </li>
                  ))}
                  <li className="border-t border-bone pt-sm font-body-sm text-body-sm">
                    <span className="font-semibold text-ink-900">
                      Net effect
                    </span>{" "}
                    ·{" "}
                    <span
                      className={cn(
                        "font-mono",
                        adjustments.pct > 0 ? "text-error" : "text-tertiary",
                      )}
                    >
                      <Figure value={adjustedTotal - baseTotal} format="signed" provenance={sensitivityProv("Net sensitivity effect", adjustedTotal - baseTotal)} />
                    </span>
                  </li>
                </ul>
              )}
            </div>
          </aside>
          ))}
      </div>

      {/* P7: optional furniture — visually separated, never in contractor scope */}
      {furnitureSection && (
        <FurnitureBlock
          section={furnitureSection}
          on={furnitureOn}
          onToggle={() => setFurnitureOn((v) => !v)}
        />
      )}

      {/* Sidebar toggle tab when closed */}
      {!sidebarOpen && (
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open sensitivity panel"
          className="focus-ring fixed right-0 top-1/2 z-30 flex h-32 w-9 -translate-y-1/2 items-center justify-center rounded-l-lg bg-brass-600 text-on-primary"
        >
          <span
            className="rotate-90 whitespace-nowrap font-label-caps text-label-caps uppercase tracking-widest"
            style={{ writingMode: "horizontal-tb" }}
          >
            Sensitivity
          </span>
        </button>
      )}
      </>
      )}
    </FigureProvenanceProvider>
  );
}

function SummaryRow({
  label,
  note,
  value,
  provenance,
  format = "amount",
  strong = false,
  dataAttr,
}: {
  label: string;
  note?: string;
  value: number;
  provenance: FigureProvenance | null;
  format?: "amount" | "signed";
  strong?: boolean;
  dataAttr?: string;
}) {
  return (
    <tr className={cn("border-t", strong ? "border-ink-900" : "border-ink-100")} data-summary-row={dataAttr ?? label.split(" ")[0]!.toLowerCase()} {...(dataAttr === "ohp" ? { "data-ohp-line": "true" } : {})}>
      <td className="px-md py-sm" colSpan={5}>
        <span className={cn("font-body-sm text-body-sm text-ink-900", strong && "font-semibold")}>{label}</span>
        {note && <span className="ml-sm font-body-sm text-[12px] text-ink-500">{note}</span>}
      </td>
      <td className="px-md py-sm text-right font-mono text-body-sm text-ink-900">
        <Figure value={value} format={format} provenance={provenance} />
      </td>
      <td colSpan={2} />
    </tr>
  );
}

function ByRoomView({
  byRoom,
  highlightRoom,
}: {
  byRoom: RoomRollupView[];
  highlightRoom: string | null;
}) {
  const [open, setOpen] = useState<string | null>(highlightRoom);
  return (
    <section className="mt-xl overflow-hidden rounded-xl border border-ink-100 bg-paper">
      <p className="border-b border-ink-100 bg-canvas px-md py-sm label-caps text-on-surface-variant">
        Cost by room — read-only rollup of the element take-off (POMI sections remain the export format)
      </p>
      <ul>
        {byRoom.map((r) => {
          const expanded = open === r.roomId;
          return (
            <li key={r.roomId} id={`boq-room-${r.roomId}`} className="border-b border-ink-100">
              <button
                type="button"
                onClick={() => setOpen((cur) => (cur === r.roomId ? null : r.roomId))}
                className="flex w-full items-center justify-between gap-md px-md py-md text-left transition-colors hover:bg-surface-container-low"
              >
                <span className="flex items-center gap-sm">
                  <span
                    className="material-symbols-outlined text-[18px] text-on-surface-variant"
                    style={{ transform: expanded ? "rotate(90deg)" : "none" }}
                    aria-hidden="true"
                  >
                    chevron_right
                  </span>
                  <span className="font-body-sm text-body-sm font-semibold text-ink-900">
                    {r.roomName}
                  </span>
                </span>
                <span className="font-mono text-body-sm tabular-nums text-ink-900">
                  <Figure
                    value={r.total_aed}
                    provenance={{
                      title: `Room total — ${r.roomName}`,
                      steps: [
                        { kind: "geometry", label: "Element take-off", detail: `Σ ${r.items.length} take-off item${r.items.length === 1 ? "" : "s"} measured in this room (takeoff_items)` },
                        { kind: "tier", label: "Element rate", detail: "Each item at the same rate as its BoQ line — the project's contractor rate book where it has one, otherwise the representative element rate. Excludes OH&P, contingency and VAT, and lines not attributable to a room." },
                      ],
                      flags: ["excl. contingency & VAT"],
                      traceable: true,
                    }}
                  />
                </span>
              </button>
              {expanded && (
                <table className="w-full border-t border-bone text-left">
                  <tbody>
                    {r.items.map((w, i) => (
                      <tr key={i} className="border-b border-bone last:border-0">
                        <td className="px-md py-sm pl-12 font-body-sm text-body-sm text-ink-900">
                          {w.description}
                        </td>
                        <td className="px-md py-sm text-right font-mono text-[12px] tabular-nums text-on-surface-variant">
                          {w.qty.toLocaleString("en-US")} {w.unit}
                        </td>
                        <td className="px-md py-sm text-right font-mono text-body-sm tabular-nums text-ink-900">
                          <Figure
                            value={w.total_aed}
                            provenance={{
                              title: `${w.description} — ${r.roomName}`,
                              steps: [
                                { kind: "geometry", label: "Measured", detail: `${fmtQty(w.qty)} ${w.unit} in this room (takeoff_items)` },
                                { kind: "tier", label: "Element rate", detail: "The same rate as this item's BoQ line (contractor rate book where the project has one, otherwise the representative element rate)." },
                              ],
                              flags: [],
                              traceable: true,
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// P7 — the optional furniture section, rendered apart from the POMI table with
// an OPTIONAL eyebrow. Toggling it off subtracts its total exactly (the header
// toggle and the what-if-panel toggle drive the same state).
// ---------------------------------------------------------------------------

function FurnitureBlock({
  section,
  on,
  onToggle,
}: {
  section: FurnitureSection;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <section
      className={cn(
        "mt-xl overflow-hidden rounded-xl border border-dashed bg-paper transition-opacity",
        on ? "border-brass-600/50" : "border-ink-100 opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-md border-b border-bone bg-canvas px-md py-md">
        <div className="flex flex-col gap-0.5">
          <span className="label-caps text-tertiary">
            Optional — not in contractor scope
          </span>
          <span className="font-display text-headline-md text-ink-900">
            {section.work_section}
          </span>
          <span className="font-body-sm text-[12px] italic text-on-surface-variant">
            Indicative Dubai retail — furnishing your staged renders. Excluded
            from the contractor package.
          </span>
        </div>
        <div className="flex items-center gap-md">
          <span className="font-mono text-body-md tabular-nums text-ink-900">
            {on ? (
              <Figure
                value={section.section_total_aed}
                provenance={{ title: "Furniture (optional)", steps: [{ kind: "arith", label: `Σ ${section.lines.length} lines`, detail: formatAed(section.section_total_aed) }, { kind: "tier", label: "Indicative", detail: "Indicative Dubai retail — never in contractor scope." }], flags: ["indicative"], traceable: true }}
              />
            ) : "—"}
          </span>
          <button
            type="button"
            onClick={onToggle}
            aria-pressed={on}
            className={cn(
              "focus-ring flex h-9 items-center gap-xs rounded-lg border px-md font-body-sm text-body-sm font-semibold transition-colors",
              on
                ? "border-brass-600 bg-primary-fixed/40 text-ink-900"
                : "border-ink-100 bg-paper text-ink-700 hover:bg-surface-container-low",
            )}
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              {on ? "check_circle" : "add_circle"}
            </span>
            {on ? "In your total" : "Add to total"}
          </button>
        </div>
      </div>
      <table className="w-full table-fixed text-left">
        <colgroup>
          <col />
          <col className="w-[52px]" />
          <col className="w-[96px]" />
          <col className="w-[112px]" />
          <col className="w-[140px]" />
        </colgroup>
        <tbody>
          {section.lines.map((line, idx) => (
            <tr
              key={idx}
              className={cn(
                "border-b border-bone last:border-0",
                idx % 2 === 1 ? "bg-canvas" : "bg-paper",
              )}
            >
              <td className="px-md py-sm">
                <span className="flex items-center gap-xs font-body-sm text-body-sm text-ink-900">
                  <span
                    title="Indicative retail price"
                    aria-label="Indicative price"
                    className="inline-block size-1.5 shrink-0 rounded-full bg-tertiary"
                  />
                  {line.description}
                </span>
              </td>
              <td className="px-md py-sm text-right font-mono text-body-sm tabular-nums text-on-surface-variant">
                {line.quantity}
              </td>
              <td className="px-md py-sm text-right font-mono text-body-sm tabular-nums text-ink-900">
                <Figure value={line.rate_aed} format="rate" provenance={{ title: `Rate — ${line.description}`, steps: [{ kind: "tier", label: "Indicative", detail: "Indicative Dubai retail price for this piece at the style's tier." }, { kind: "source", label: "Retail tier", detail: line.vendor_or_source }, { kind: "qs", label: "QS validation", detail: "Indicative — not QS-validated." }], flags: ["indicative"], traceable: true }} />
              </td>
              <td className="px-md py-sm text-right font-mono text-body-sm tabular-nums text-ink-900">
                <Figure value={line.total_aed} format="amount" provenance={{ title: `Total — ${line.description}`, steps: [{ kind: "arith", label: "Quantity × rate", detail: `${fmtQty(line.quantity)} × ${formatAed(line.rate_aed, "rate")} = ${formatAed(line.total_aed, "amount")}` }], flags: ["indicative"], traceable: true }} />
              </td>
              <td className="px-md py-sm font-body-sm text-[12px] text-on-surface-variant">
                <span className="line-clamp-2">{line.vendor_or_source}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "label-caps bg-canvas px-md py-sm align-bottom text-on-surface-variant",
        className,
      )}
    >
      {children}
    </th>
  );
}

function SectionGroup({
  section,
  expandedKey,
  onToggle,
  lineOptions,
  highlightRef,
  changedItems,
  provenance,
}: {
  section: BoqSection;
  expandedKey: string | null;
  onToggle: (k: string) => void;
  lineOptions: Record<string, VendorOption[]>;
  highlightRef: string | null;
  changedItems: Set<GradeableItem>;
  provenance: BoqProvenance | null;
}) {
  return (
    <>
      <tr className="bg-bone">
        <td colSpan={6} className="h-14 px-md">
          <span className="font-display text-headline-md text-ink-900">
            {section.work_section}
          </span>
        </td>
        <td
          colSpan={2}
          className="px-md text-right font-mono text-body-sm tabular-nums text-ink-900"
        >
          <Figure value={section.section_total_aed} provenance={provenance?.sections[section.work_section] ?? null} />
        </td>
      </tr>
      {section.lines.map((line, idx) => {
        const key = `${section.work_section}-${idx}`;
        const ref = sectionRef(section.work_section, idx);
        const expanded = expandedKey === key;
        const gi = itemKeyFromRuleId(line.rule_id);
        return (
          <LineRow
            key={key}
            lineKey={key}
            ref_={ref}
            line={line}
            zebra={idx % 2 === 1}
            expanded={expanded}
            onToggle={() => onToggle(key)}
            options={lineOptions[key] ?? []}
            highlighted={ref === highlightRef}
            scenarioChanged={gi ? changedItems.has(gi) : false}
            prov={provenance?.lines[key] ?? null}
          />
        );
      })}
    </>
  );
}

function LineRow({
  lineKey,
  ref_,
  line,
  zebra,
  expanded,
  onToggle,
  options,
  highlighted,
  scenarioChanged,
  prov,
}: {
  prov: LineProvenance | null;
  lineKey: string;
  ref_: string;
  line: BoqLine;
  zebra: boolean;
  expanded: boolean;
  onToggle: () => void;
  options: VendorOption[];
  highlighted: boolean;
  scenarioChanged: boolean;
}) {
  const sensitivity = sensitivityFor(lineKey.split("-")[0] ?? "", line) ?? null;
  return (
    <>
      <tr
        id={`boq-row-${ref_}`}
        className={cn(
          "border-b border-ink-100 transition-colors",
          zebra ? "bg-canvas" : "bg-paper",
          expanded ? "bg-surface-container-low" : "hover:bg-surface-container-low/60",
          highlighted && "bg-primary-fixed/40 ring-2 ring-inset ring-brass-600",
        )}
      >
        <td className="px-md py-sm font-mono text-[12px] tabular-nums text-ink-500">
          {ref_}
        </td>
        <td className="px-md py-sm">
          <p className="flex items-center gap-xs font-body-sm text-body-sm text-ink-900">
            {scenarioChanged && (
              <span
                title="Changed in your what-if scenario"
                aria-label="Changed in scenario"
                className="inline-block size-1.5 shrink-0 rounded-full bg-brass-600"
              />
            )}
            {line.rate_status === "needs_qs" && (
              <span
                title="Rate to be confirmed by the QS"
                aria-label="Needs QS pricing"
                className="inline-block size-1.5 shrink-0 rounded-full bg-tertiary"
              />
            )}
            {line.rate_status === "indicative" && (
              <span
                title="Indicative rate — a defensible estimate, not a transaction. Pending QS review."
                aria-label="Indicative rate — pending QS review"
                className="inline-block size-1.5 shrink-0 rounded-full bg-tertiary"
              />
            )}
            {line.rate_status === "site_assessment" && (
              <span
                title="Allowance only — requires site measurement"
                aria-label="Allowance — needs site measurement"
                className="inline-block size-1.5 shrink-0 rounded-full bg-error"
              />
            )}
            {line.rate_status === "actual_transaction" && (
              <span
                title="Priced from a real contract/quotation (actual)"
                aria-label="Actual contract rate"
                className="inline-block size-1.5 shrink-0 rounded-full bg-brass-600"
              />
            )}
            {/* G3. A real rate, but the DEFAULT of a choice nobody has made —
                and the cheaper of the two. It carries the same terracotta dot
                as the other unsettled states precisely so it cannot read as
                finished. */}
            {line.rate_status === "needs_selection" && (
              <span
                title="Priced at the cheaper default — someone still has to choose which it is"
                aria-label="Awaiting a selection"
                className="inline-block size-1.5 shrink-0 rounded-full bg-error"
              />
            )}
            {line.description}
          </p>
          {line.qty_derived && (
            <p className="mt-1 font-body-sm text-[12px] text-error" data-derived-line="true">
              {derivedLineNote(line)}
            </p>
          )}
          {line.notes && (
            <p className="mt-1 font-body-sm text-[12px] text-on-surface-variant">
              {line.notes}
            </p>
          )}
        </td>
        <td className="px-md py-sm font-mono text-body-sm text-on-surface-variant">
          {line.unit}
        </td>
        <td className="px-md py-sm text-right font-mono text-body-sm tabular-nums text-ink-900">
          <Figure value={line.quantity} text={fmtQty(line.quantity)} provenance={prov?.quantity ?? null} />
        </td>
        <td className="px-md py-sm text-right font-mono text-body-sm tabular-nums text-ink-900">
          <Figure value={line.rate_aed} format="rate" provenance={prov?.rate ?? null} />
        </td>
        <td className="px-md py-sm text-right font-mono text-body-sm tabular-nums text-ink-900">
          <Figure value={line.total_aed} format="rate" provenance={prov?.total ?? null} />
        </td>
        <td className="px-md py-sm font-body-sm text-[12px] text-on-surface-variant">
          <span className="line-clamp-2">{line.vendor_or_source}</span>
        </td>
        <td className="px-md py-sm">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse details" : "Expand details"}
            className="focus-ring flex size-8 items-center justify-center rounded text-on-surface-variant hover:text-ink-900"
          >
            <motion.span
              animate={{ rotate: expanded ? 90 : 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="material-symbols-outlined text-[18px]"
              aria-hidden="true"
            >
              chevron_right
            </motion.span>
          </button>
        </td>
      </tr>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.tr
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="bg-surface-container-low"
          >
            <td colSpan={8} className="px-md py-md">
              <div className="grid grid-cols-1 gap-lg lg:grid-cols-[2fr_3fr]">
                {/* Sensitivity + source */}
                <div className="flex flex-col gap-sm">
                  <p className="label-caps text-ink-500">Sensitivity</p>
                  <p className="font-body-sm text-body-sm text-ink-900">
                    {sensitivity?.description ??
                      "No swap impact modelled for this line yet."}
                  </p>
                  <p className="mt-xs label-caps text-ink-500">Source</p>
                  <p className="font-body-sm text-body-sm text-on-surface-variant">
                    {line.vendor_or_source}
                  </p>
                </div>
                {/* Alternative vendor mini cards */}
                <div className="flex flex-col gap-sm">
                  <p className="label-caps text-ink-500">
                    Alternative vendors
                  </p>
                  {options.length === 0 ? (
                    <p className="font-body-sm text-body-sm text-on-surface-variant">
                      No vetted alternatives in the ±25% band for this line.
                    </p>
                  ) : (
                    <div className="grid grid-cols-3 gap-sm">
                      {options.map((opt) => (
                        <VendorMini key={opt.id} option={opt} unit={line.unit} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </td>
          </motion.tr>
        )}
      </AnimatePresence>
    </>
  );
}

function VendorMini({
  option,
  unit,
}: {
  option: VendorOption;
  unit: string;
}) {
  return (
    <div className="flex flex-col gap-xs rounded-lg border border-ink-100 bg-paper p-sm">
      {option.photo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={option.photo_url}
          alt={option.description ?? option.sku ?? "alternative"}
          className="aspect-[4/3] w-full rounded object-cover"
          onError={(e) => {
            const el = e.currentTarget;
            el.style.background =
              "linear-gradient(135deg, #C9B79A 0%, #6B5B3E 100%)";
            el.removeAttribute("src");
          }}
        />
      ) : (
        <div className="aspect-[4/3] w-full rounded bg-bone" />
      )}
      <p className="truncate font-body-sm text-body-sm font-semibold text-ink-900">
        {option.brand ?? "—"}
      </p>
      <p className="truncate font-mono text-[11px] text-ink-500">
        {option.sku ?? "—"}
      </p>
      <p className="font-mono text-body-sm tabular-nums text-ink-900">
        <Figure
          value={option.price_aed}
          text={`AED ${formatAed(option.price_aed, "rate")}`}
          provenance={{ title: `${option.brand ?? "Alternative"} ${option.sku ?? ""}`.trim(), steps: [{ kind: "source", label: "Supplier catalogue", detail: "pricing_skus list price — the brand and SKU are the specification. Not in the BoQ until chosen on the vendors step." }], flags: ["alternative, not priced in"], traceable: true }}
        />
        <span className="text-ink-500"> / {unit}</span>
      </p>
    </div>
  );
}

/** G5d (Newspace session ask #5): the indicative programme, scaled from one comparable garden. */
function ProgrammePanel({ programme }: { programme: NonNullable<BoqPayload["programme"]> }) {
  return (
    <section className="mt-xl rounded-xl border border-ink-100 bg-paper p-lg">
      <div className="flex items-baseline justify-between gap-md">
        <span className="label-caps text-brass-600">Indicative delivery programme</span>
        <span className="font-mono text-body-sm tabular-nums text-[#9d3e1d]">≈ {programme.total_days} days · indicative · derived</span>
      </div>
      <ul className="mt-md space-y-sm">
        {programme.phases.map((p) => (
          <li key={p.name} className="grid grid-cols-[220px_56px_1fr] items-center gap-md">
            <span className="text-body-sm text-ink-900">{p.name}</span>
            <span className="text-right font-mono text-body-sm tabular-nums text-ink-700">{p.days} d</span>
            <span className="relative h-3 rounded bg-canvas">
              <span
                className="absolute inset-y-0 rounded bg-brass-600/75"
                style={{ left: `${((p.start_day - 1) / programme.total_days) * 100}%`, width: `${Math.max(1, (p.days / programme.total_days) * 100)}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-md text-body-sm text-ink-500">{programme.basis}</p>
    </section>
  );
}

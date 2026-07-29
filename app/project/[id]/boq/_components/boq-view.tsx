"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import {
  recalc,
  suggestForBudget,
  type RateBook,
  type ScenarioBoq,
  type Selections,
} from "@/lib/whatif/engine";
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
  // P7 adds "indicative" for furniture (ballpark retail, not a QS rate).
  element_refs?: string[] | null;
  rate_status?: "priced" | "needs_qs" | "indicative";
  // P4/P5: engine rule id (P4/quantify/<key> marks a gradeable line).
  rule_id?: string;
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

function formatAed(n: number): string {
  return `AED ${Math.round(n).toLocaleString("en-US")}`;
}

function formatAedSigned(n: number): string {
  const abs = Math.abs(Math.round(n)).toLocaleString("en-US");
  return n >= 0 ? `+AED ${abs}` : `−AED ${abs}`;
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
    () => ({ grand_total_aed: boq.grand_total_aed, sections: boq.sections }),
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

  const adjustedTotal = Math.round(baseTotal * (1 + adjustments.pct / 100));
  const scopeTotal = whatifOn && scenario ? scenario.total : adjustedTotal;
  const furnitureIncluded = furnitureOn ? furnitureTotal : 0;
  const displayTotal = scopeTotal + furnitureIncluded;
  const headroom = budgetAed - displayTotal;

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

  return (
    <>
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
            {formatAed(displayTotal)}
          </motion.h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            against your {formatAed(budgetAed)} budget —{" "}
            <span
              className={cn(
                "font-semibold",
                headroom >= 0 ? "text-tertiary" : "text-error",
              )}
            >
              {formatAed(Math.abs(headroom))}{" "}
              {headroom >= 0 ? "headroom" : "over"}
            </span>
            {adjustments.pct !== 0 && (
              <>
                {" "}
                ·{" "}
                <span className="text-ink-500">
                  base {formatAed(baseTotal)} · adjusted{" "}
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
                />
              ))}
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
                    {formatAed(displayTotal)}
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
                  {formatAed(baseTotal)}.
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
                        {formatAedSigned(baseTotal * (c.pct / 100))}
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
                      {formatAedSigned(adjustedTotal - baseTotal)}
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
    </>
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
                  {formatAed(r.total_aed)}
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
                          {formatAed(w.total_aed)}
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
            {on ? formatAed(section.section_total_aed) : "—"}
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
                {line.rate_aed.toLocaleString("en-US")}
              </td>
              <td className="px-md py-sm text-right font-mono text-body-sm tabular-nums text-ink-900">
                {line.total_aed.toLocaleString("en-US")}
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
}: {
  section: BoqSection;
  expandedKey: string | null;
  onToggle: (k: string) => void;
  lineOptions: Record<string, VendorOption[]>;
  highlightRef: string | null;
  changedItems: Set<GradeableItem>;
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
          {formatAed(section.section_total_aed)}
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
}: {
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
            {line.description}
          </p>
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
          {line.quantity.toLocaleString("en-US")}
        </td>
        <td className="px-md py-sm text-right font-mono text-body-sm tabular-nums text-ink-900">
          {line.rate_aed.toLocaleString("en-US")}
        </td>
        <td className="px-md py-sm text-right font-mono text-body-sm tabular-nums text-ink-900">
          {line.total_aed.toLocaleString("en-US")}
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
        AED {option.price_aed.toLocaleString("en-US")}
        <span className="text-ink-500"> / {unit}</span>
      </p>
    </div>
  );
}

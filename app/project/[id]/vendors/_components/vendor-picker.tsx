"use client";

import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { SendModal } from "./send-modal";

const TERRACOTTA = "#B85042";

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

export type LineCard = {
  line_key: string;
  work_section: string;
  description: string;
  notes: string | null;
  quantity: number;
  unit: string;
  base_rate_aed: number;
  base_total_aed: number;
  current: VendorOption;
  alternatives: VendorOption[];
};

export type BoqMeta = {
  boq_id: string;
  contingency_pct: number;
  vat_pct: number;
  base_subtotal_aed: number;
  base_grand_total_aed: number;
  budget_aed: number;
};

type Props = {
  projectId: string;
  boqMeta: BoqMeta;
  lines: LineCard[];
};

function formatAed(n: number): string {
  return `AED ${Math.round(n).toLocaleString("en-US")}`;
}

// LineState: which SKU is currently in the "main" slot, and which 3 are alts.
type LineState = {
  current: VendorOption;
  alternatives: VendorOption[];
};

export function VendorPicker({ projectId, boqMeta, lines }: Props) {
  // Per-line state: who's the current pick, and what alternates surround it.
  const [state, setState] = useState<Record<string, LineState>>(() => {
    const initial: Record<string, LineState> = {};
    for (const l of lines) {
      initial[l.line_key] = {
        current: l.current,
        alternatives: l.alternatives,
      };
    }
    return initial;
  });

  const [modalOpen, setModalOpen] = useState(false);

  // Recompute the grand total whenever the per-line picks change. We use the
  // server-provided baseline (subtotal_aed, etc.), then apply deltas only for
  // lines that the user can swap on this page — every other section line is
  // untouched.
  const totals = useMemo(() => {
    let delta = 0;
    for (const l of lines) {
      const picked = state[l.line_key]?.current ?? l.current;
      const newLineTotal = Math.round(l.quantity * picked.price_aed);
      delta += newLineTotal - l.base_total_aed;
    }
    const subtotal = boqMeta.base_subtotal_aed + delta;
    const contingency = Math.round((subtotal * boqMeta.contingency_pct) / 100);
    const vat = Math.round(((subtotal + contingency) * boqMeta.vat_pct) / 100);
    const grand = subtotal + contingency + vat;
    return { subtotal, contingency, vat, grand };
  }, [state, lines, boqMeta]);

  const budgetCompare = useMemo(() => {
    const budget = boqMeta.budget_aed;
    if (budget <= 0) return null;
    const diff = budget - totals.grand;
    const pct = Math.round((Math.abs(diff) / budget) * 100);
    if (pct <= 1) return { tone: "on-target" as const, label: "On target" };
    return diff > 0
      ? { tone: "under" as const, label: `${pct}% under` }
      : { tone: "over" as const, label: `${pct}% over` };
  }, [totals.grand, boqMeta.budget_aed]);

  async function pick(lineKey: string, option: VendorOption) {
    setState((prev) => {
      const cur = prev[lineKey];
      if (!cur || cur.current.id === option.id) return prev;
      const newAlts = cur.alternatives
        .filter((a) => a.id !== option.id)
        .concat(cur.current);
      return {
        ...prev,
        [lineKey]: { current: option, alternatives: newAlts },
      };
    });

    // Fire-and-forget persistence. Errors land in console + dev server logs.
    fetch("/api/vendor-selections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        boq_id: boqMeta.boq_id,
        boq_line_id: lineKey,
        sku_id: option.id,
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          console.warn(
            "[vendor-picker] save failed:",
            body?.error ?? res.status,
          );
        }
      })
      .catch((err) => console.warn("[vendor-picker] save error:", err));
  }

  return (
    <div className="pb-32">
      <StickyTotalBar
        totals={totals}
        boqMeta={boqMeta}
        compare={budgetCompare}
      />

      <div className="mt-8 flex flex-col gap-6">
        {lines.map((line) => {
          const s = state[line.line_key]!;
          return (
            <LineRow
              key={line.line_key}
              line={line}
              state={s}
              onPick={(opt) => pick(line.line_key, opt)}
            />
          );
        })}
      </div>

      {/* STICKY FOOTER ------------------------------------------------- */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-outline-variant bg-surface/95 backdrop-blur-sm">
        <div className="ml-64 px-6 py-4">
          <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4">
            <p className="text-label-md text-on-surface-variant">
              Final total: <span className="text-on-surface tabular-nums">{formatAed(totals.grand)}</span>
              {budgetCompare && <> · {budgetCompare.label}</>}
            </p>
            <Button onClick={() => setModalOpen(true)}>
              Send to contractors
              <span
                className="material-symbols-outlined ml-1 text-base"
                aria-hidden="true"
              >
                send
              </span>
            </Button>
          </div>
        </div>
      </div>

      <SendModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function StickyTotalBar({
  totals,
  boqMeta,
  compare,
}: {
  totals: { subtotal: number; contingency: number; vat: number; grand: number };
  boqMeta: BoqMeta;
  compare: { tone: "under" | "over" | "on-target"; label: string } | null;
}) {
  const compareCls =
    compare?.tone === "under"
      ? "border-status-success/40 bg-status-success/15 text-status-success"
      : compare?.tone === "over"
        ? "border-status-error/40 bg-status-error/15 text-status-error"
        : "border-outline-variant bg-surface-container-low text-on-surface-variant";

  return (
    <section className="mt-8 rounded-2xl border border-outline-variant bg-surface-container p-6">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="flex flex-col gap-1">
          <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">
            Updated grand total
          </p>
          <PulseNumber value={totals.grand} />
          <p className="text-body-md text-on-surface-variant">
            Budget: {formatAed(boqMeta.budget_aed)}
            {compare && (
              <Badge
                variant="secondary"
                className={cn("ml-3 border", compareCls)}
              >
                {compare.label}
              </Badge>
            )}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <SummaryChip label="Subtotal" value={formatAed(totals.subtotal)} />
          <SummaryChip
            label={`Contingency ${boqMeta.contingency_pct}%`}
            value={formatAed(totals.contingency)}
          />
          <SummaryChip
            label={`VAT ${boqMeta.vat_pct}%`}
            value={formatAed(totals.vat)}
          />
        </div>
      </div>
    </section>
  );
}

function PulseNumber({ value }: { value: number }) {
  return (
    <AnimatePresence mode="popLayout">
      <motion.span
        key={value}
        initial={{ scale: 1 }}
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="block text-[48px] leading-[1.05] font-semibold tabular-nums"
        style={{
          fontFamily: '"Georgia", "Times New Roman", serif',
          color: TERRACOTTA,
        }}
      >
        {formatAed(value)}
      </motion.span>
    </AnimatePresence>
  );
}

function SummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-full border border-outline-variant bg-surface-container-low px-3 py-1.5">
      <span className="text-label-sm uppercase tracking-wider text-on-surface-variant">
        {label}
      </span>
      <span className="text-label-md tabular-nums text-on-surface">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------

function LineRow({
  line,
  state,
  onPick,
}: {
  line: LineCard;
  state: LineState;
  onPick: (opt: VendorOption) => void;
}) {
  const lineTotal = Math.round(line.quantity * state.current.price_aed);
  const delta = lineTotal - line.base_total_aed;

  return (
    <article className="rounded-2xl border border-outline-variant bg-surface-container p-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex flex-col gap-1">
          <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">
            {line.work_section}
          </p>
          <h3 className="text-h3 text-on-surface">{line.description}</h3>
          {line.notes && (
            <p className="text-label-sm text-on-surface-variant">{line.notes}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-0.5 text-right">
          <p className="text-label-sm text-on-surface-variant">
            {line.quantity.toLocaleString("en-US")} {line.unit} ×{" "}
            <span className="tabular-nums">{formatAed(state.current.price_aed)}</span>
          </p>
          <PulseNumber value={lineTotal} />
          {delta !== 0 && (
            <p
              className={cn(
                "text-label-sm tabular-nums",
                delta > 0 ? "text-status-error" : "text-status-success",
              )}
            >
              {delta > 0 ? "+" : "−"}
              {formatAed(Math.abs(delta))} vs BoQ
            </p>
          )}
        </div>
      </header>

      <LayoutGroup id={line.line_key}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_3fr]">
          <div>
            <p className="mb-2 text-label-sm uppercase tracking-wider text-on-surface-variant">
              Selected vendor
            </p>
            <OptionCard
              option={state.current}
              variant="main"
              line={line}
              layoutKey={`opt-${line.line_key}-${state.current.id}`}
            />
          </div>

          <div>
            <p className="mb-2 text-label-sm uppercase tracking-wider text-on-surface-variant">
              Alternatives ({state.alternatives.length})
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {state.alternatives.map((opt) => (
                <OptionCard
                  key={opt.id}
                  option={opt}
                  variant="alt"
                  line={line}
                  layoutKey={`opt-${line.line_key}-${opt.id}`}
                  onClick={() => onPick(opt)}
                />
              ))}
              {state.alternatives.length === 0 && (
                <div className="col-span-full rounded-lg border border-dashed border-outline-variant px-3 py-6 text-center text-label-sm text-on-surface-variant">
                  No alternatives in the ±25% band.
                </div>
              )}
            </div>
          </div>
        </div>
      </LayoutGroup>
    </article>
  );
}

// ---------------------------------------------------------------------------

function OptionCard({
  option,
  variant,
  line,
  layoutKey,
  onClick,
}: {
  option: VendorOption;
  variant: "main" | "alt";
  line: LineCard;
  layoutKey: string;
  onClick?: () => void;
}) {
  const isMain = variant === "main";
  const interactive = !isMain && onClick != null;

  const baseClass = cn(
    "flex h-full flex-col gap-2 overflow-hidden rounded-xl border bg-surface-container-low transition-colors",
    isMain
      ? "border-indigo-500/40 bg-indigo-500/5"
      : interactive
        ? "cursor-pointer border-outline-variant hover:border-indigo-500/40 hover:bg-surface-container-high/40"
        : "border-outline-variant",
  );

  const padClass = isMain ? "p-4" : "p-3";

  // Photo / fallback header — gradient is derived from the brand string so
  // each vendor renders a stable colour even when photo_url is null.
  const photoBox = (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-md",
        isMain ? "aspect-[16/9]" : "aspect-square",
      )}
    >
      {option.photo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={option.photo_url}
          alt={option.description ?? option.sku ?? "vendor option"}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{ background: gradientFromString(option.brand ?? option.sku ?? "?") }}
          aria-hidden="true"
        />
      )}
      {option.in_stock === false && (
        <span className="absolute right-2 top-2 rounded-full bg-status-error/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
          Out of stock
        </span>
      )}
    </div>
  );

  return (
    <motion.button
      layoutId={layoutKey}
      type="button"
      onClick={onClick}
      disabled={!interactive}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className={cn(baseClass, padClass, "text-left")}
      whileHover={interactive ? { y: -2 } : undefined}
    >
      {photoBox}
      <div className="flex flex-col gap-0.5">
        <p
          className={cn(
            "truncate font-semibold text-on-surface",
            isMain ? "text-body-md" : "text-label-md",
          )}
        >
          {option.brand ?? "—"}
        </p>
        <p
          className={cn(
            "truncate text-on-surface-variant",
            isMain ? "text-label-md" : "text-label-sm",
          )}
        >
          {option.sku ?? "—"}
        </p>
        {isMain && option.description && (
          <p className="line-clamp-2 text-label-sm text-on-surface-variant">
            {option.description}
          </p>
        )}
      </div>
      <div className="mt-auto flex items-baseline justify-between gap-2 pt-1">
        <span
          className={cn(
            "tabular-nums font-semibold text-on-surface",
            isMain ? "text-h3" : "text-body-md",
          )}
        >
          {formatAed(option.price_aed)}
        </span>
        <span className="text-label-sm text-on-surface-variant">
          / {line.unit}
        </span>
      </div>
      {option.lead_time_days != null && (
        <p className="text-label-sm text-on-surface-variant">
          Lead time: {option.lead_time_days} days
        </p>
      )}
    </motion.button>
  );
}

function gradientFromString(s: string): string {
  let h1 = 0;
  for (let i = 0; i < s.length; i++) h1 = (h1 * 31 + s.charCodeAt(i)) % 360;
  const h2 = (h1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${h1} 35% 32%), hsl(${h2} 30% 22%))`;
}

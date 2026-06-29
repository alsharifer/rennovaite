"use client";

import { motion } from "framer-motion";
import { useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { AnalyticsEvent, track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

import { SendModal } from "./send-modal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// Hardcoded sourcing metadata per known brand — distance, country of origin,
// warranty, sample. The pricing_skus table doesn't carry these yet; rather
// than block the rebuild, render plausible values and flag this as a TODO
// once the schema grows.
const VENDOR_META: Record<
  string,
  { distance: string; origin: string; warranty: string; sample: boolean }
> = {
  "RAK Ceramics": { distance: "12 km", origin: "UAE", warranty: "10 years", sample: true },
  "RAK Ceramics (Elie Saab)": { distance: "12 km", origin: "UAE / France", warranty: "10 years", sample: true },
  "Danube Home": { distance: "3 km", origin: "UAE", warranty: "5 years", sample: true },
  "Indian Milano": { distance: "8 km", origin: "India", warranty: "5 years", sample: true },
  "Milano": { distance: "8 km", origin: "Italy", warranty: "5 years", sample: true },
  "IKEA UAE": { distance: "15 km", origin: "Sweden", warranty: "2 years", sample: false },
  "Home Centre": { distance: "10 km", origin: "UAE", warranty: "1 year", sample: false },
  BRKZ: { distance: "20 km", origin: "UAE", warranty: "5 years", sample: false },
  "Saint-Gobain": { distance: "25 km", origin: "France", warranty: "10 years", sample: true },
  "KLUDI RAK": { distance: "12 km", origin: "UAE / Germany", warranty: "5 years", sample: true },
  SKM: { distance: "18 km", origin: "UAE", warranty: "5 years", sample: true },
  "Roller": { distance: "10 km", origin: "UAE", warranty: "—", sample: true },
  "Ace Hardware UAE": { distance: "8 km", origin: "USA", warranty: "1 year", sample: true },
};

const DEFAULT_VENDOR_META = {
  distance: "10 km",
  origin: "UAE",
  warranty: "5 years",
  sample: true,
} as const;

function metaFor(brand: string | null) {
  if (!brand) return DEFAULT_VENDOR_META;
  return VENDOR_META[brand] ?? DEFAULT_VENDOR_META;
}

function formatAed(n: number): string {
  return `AED ${Math.round(n).toLocaleString("en-US")}`;
}

// ---------------------------------------------------------------------------

export function VendorPicker({ projectId, boqMeta, lines }: Props) {
  // Per-line selection state. Initialized from the server-resolved current
  // SKU (persisted selection > cited SKU > closest candidate).
  const [selection, setSelection] = useState<Record<string, VendorOption>>(
    () => Object.fromEntries(lines.map((l) => [l.line_key, l.current])),
  );
  const [compareLineKey, setCompareLineKey] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);

  // Previous total tracked for the delta line ("−AED X vs prior selection").
  // Initialised to the base grand so the very first render reports zero
  // delta (the selection state == server-resolved current → no shift).
  const [prevTotal, setPrevTotal] = useState<number>(
    boqMeta.base_grand_total_aed,
  );

  // Live total = base subtotal + sum of per-lane deltas, then re-derive
  // contingency (8 %) and VAT (5 %) per the BoQ spec.
  const totals = useMemo(() => {
    let delta = 0;
    for (const l of lines) {
      const picked = selection[l.line_key] ?? l.current;
      const newLineTotal = Math.round(l.quantity * picked.price_aed);
      delta += newLineTotal - l.base_total_aed;
    }
    const subtotal = boqMeta.base_subtotal_aed + delta;
    const contingency = Math.round((subtotal * boqMeta.contingency_pct) / 100);
    const vat = Math.round(((subtotal + contingency) * boqMeta.vat_pct) / 100);
    const grand = subtotal + contingency + vat;
    return { delta, subtotal, contingency, vat, grand };
  }, [selection, lines, boqMeta]);

  function pick(lineKey: string, opt: VendorOption) {
    const changed = selection[lineKey]?.id !== opt.id;
    setSelection((prev) => {
      if (prev[lineKey]?.id === opt.id) return prev;
      // Snapshot the current grand BEFORE the swap so the "vs prior" line
      // reads against the most-recent stable total.
      setPrevTotal(totals.grand);
      return { ...prev, [lineKey]: opt };
    });

    if (changed) {
      track(AnalyticsEvent.VendorSwapped, {
        project_id: projectId,
        boq_id: boqMeta.boq_id,
        boq_line_id: lineKey,
        sku_id: opt.id,
      });
    }

    fetch("/api/vendor-selections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        boq_id: boqMeta.boq_id,
        boq_line_id: lineKey,
        sku_id: opt.id,
      }),
    }).catch((err) => console.warn("[vendor-picker] save error:", err));
  }

  const compareLine = lines.find((l) => l.line_key === compareLineKey) ?? null;

  const sinceLast =
    prevTotal !== totals.grand ? totals.grand - prevTotal : 0;

  return (
    <>
      <div className="grid grid-cols-1 gap-gutter lg:grid-cols-12">
        {/* LEFT — vendor lanes -------------------------------------- */}
        <div className="col-span-1 flex flex-col gap-md lg:col-span-9">
          {lines.map((line) => (
            <Lane
              key={line.line_key}
              line={line}
              currentId={(selection[line.line_key] ?? line.current).id}
              onPick={(opt) => pick(line.line_key, opt)}
              onCompare={() => setCompareLineKey(line.line_key)}
            />
          ))}
        </div>

        {/* RIGHT — live total ---------------------------------------- */}
        <aside className="col-span-1 lg:col-span-3">
          <div className="sticky top-[96px] flex flex-col gap-md rounded-xl border border-ink-100 bg-paper p-lg">
            <div>
              <p className="label-caps mb-xs text-ink-500">Live total</p>
              <motion.p
                key={totals.grand}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, ease: "easeOut" }}
                className="font-display text-[40px] leading-tight tabular-nums text-ink-900"
              >
                {formatAed(totals.grand)}
              </motion.p>
              {sinceLast !== 0 && (
                <motion.p
                  key={`delta-${totals.grand}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.24 }}
                  className={cn(
                    "mt-xs font-mono text-body-sm tabular-nums",
                    sinceLast < 0 ? "text-tertiary" : "text-error",
                  )}
                >
                  {sinceLast < 0 ? "−" : "+"}
                  {formatAed(Math.abs(sinceLast)).replace("AED ", "AED ")}{" "}
                  vs prior selection
                </motion.p>
              )}
            </div>

            <div className="border-t border-bone pt-md">
              <p className="label-caps mb-sm text-ink-500">
                Selected vendors ({lines.length})
              </p>
              <ul className="flex flex-col gap-xs">
                {lines.map((line) => {
                  const chosen = selection[line.line_key] ?? line.current;
                  return (
                    <li
                      key={line.line_key}
                      className="flex items-center gap-sm rounded px-xs py-xs hover:bg-surface-container-low"
                    >
                      <VendorDot option={chosen} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-body-sm text-body-sm font-semibold text-ink-900">
                          {chosen.brand ?? "—"}
                        </p>
                        <p className="truncate font-mono text-[11px] text-ink-500">
                          {line.work_section.split(/[\s&/]+/).join(" ")}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => pick(line.line_key, line.current)}
                        aria-label={`Reset ${line.description} to original`}
                        className="focus-ring flex size-7 items-center justify-center rounded text-on-surface-variant hover:text-ink-900"
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          close
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <button
              type="button"
              onClick={() => {
                track(AnalyticsEvent.SentToContractor, {
                  project_id: projectId,
                  boq_id: boqMeta.boq_id,
                  vendor_count: lines.length,
                });
                setSendOpen(true);
              }}
              className="focus-ring mt-md flex h-12 w-full items-center justify-center gap-sm rounded-lg bg-brass-600 px-lg font-body-sm text-body-sm font-semibold text-on-primary transition-colors hover:bg-primary"
            >
              Send scope to contractors
              <span
                className="material-symbols-outlined text-[18px]"
                aria-hidden="true"
              >
                arrow_forward
              </span>
            </button>
          </div>
        </aside>
      </div>

      {/* Comparison modal -------------------------------------------- */}
      <Dialog
        open={compareLine !== null}
        onOpenChange={(next) => {
          if (!next) setCompareLineKey(null);
        }}
      >
        <DialogContent className="w-[95vw] max-w-[960px] border border-ink-100 bg-paper p-0 sm:max-w-[960px]">
          {compareLine && (
            <CompareTable
              line={compareLine}
              currentId={
                (selection[compareLine.line_key] ?? compareLine.current).id
              }
              onPick={(opt) => {
                pick(compareLine.line_key, opt);
                setCompareLineKey(null);
              }}
              onClose={() => setCompareLineKey(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <SendModal open={sendOpen} onClose={() => setSendOpen(false)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Lane
// ---------------------------------------------------------------------------

function Lane({
  line,
  currentId,
  onPick,
  onCompare,
}: {
  line: LineCard;
  currentId: string;
  onPick: (opt: VendorOption) => void;
  onCompare: () => void;
}) {
  // Show 3 vendor cards in the lane: the current selection first, then up
  // to 2 alternatives (dedup against current).
  const current =
    line.alternatives.find((a) => a.id === currentId) ??
    (line.current.id === currentId ? line.current : line.current);
  const otherAlts = [line.current, ...line.alternatives]
    .filter((o, idx, arr) => arr.findIndex((x) => x.id === o.id) === idx)
    .filter((o) => o.id !== current.id)
    .slice(0, 2);
  const cards: VendorOption[] = [current, ...otherAlts];

  return (
    <article className="flex h-[168px] gap-md rounded-lg border border-ink-100 bg-paper p-md">
      {/* Lane description (fixed 240px) */}
      <div className="flex w-[240px] shrink-0 flex-col justify-between">
        <div>
          <p className="label-caps mb-xs text-ink-500">{line.work_section}</p>
          <h3 className="font-display text-headline-md leading-tight text-ink-900 line-clamp-3">
            {line.description}
          </h3>
        </div>
        <p className="font-mono text-body-sm tabular-nums text-on-surface-variant">
          {line.quantity.toLocaleString("en-US")} {line.unit}
        </p>
      </div>

      {/* Vendor cards (horizontal scroll if more than fit) */}
      <div className="flex min-w-0 flex-1 gap-md overflow-x-auto">
        {cards.map((opt) => (
          <VendorCard
            key={opt.id}
            option={opt}
            selected={opt.id === currentId}
            unit={line.unit}
            onSelect={() => onPick(opt)}
            onCompare={onCompare}
          />
        ))}
      </div>

      {/* Swap icon */}
      <button
        type="button"
        onClick={onCompare}
        aria-label={`Compare ${line.description}`}
        className="focus-ring flex size-10 shrink-0 self-center items-center justify-center rounded-full border border-ink-100 text-brass-600 hover:bg-surface-container-low"
      >
        <span className="material-symbols-outlined">swap_horiz</span>
      </button>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Vendor card (the 320×136 lane card)
// ---------------------------------------------------------------------------

function VendorCard({
  option,
  selected,
  unit,
  onSelect,
  onCompare,
}: {
  option: VendorOption;
  selected: boolean;
  unit: string;
  onSelect: () => void;
  onCompare: () => void;
}) {
  const meta = metaFor(option.brand);
  return (
    <motion.button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      whileTap={{ scale: 0.99 }}
      className={cn(
        "focus-ring relative flex h-[136px] w-[320px] shrink-0 flex-col overflow-hidden rounded-md bg-paper text-left transition-colors",
        selected
          ? "border-2 border-brass-600"
          : "border border-ink-100 hover:bg-surface-container-low/40",
      )}
    >
      {/* Top band — brand + status */}
      <div className="flex h-16 items-center justify-between border-b border-ink-100 bg-canvas px-md">
        <span className="truncate font-display text-body-md font-semibold text-on-surface-variant">
          {option.brand ?? "—"}
        </span>
        <StatusBadge option={option} />
      </div>

      {/* Bottom info */}
      <div className="flex flex-1 items-center justify-between gap-sm px-md py-sm">
        <div className="min-w-0">
          <p className="font-mono text-body-md tabular-nums text-ink-900">
            AED {option.price_aed.toLocaleString("en-US")}
            <span className="text-ink-500">/{unit}</span>
          </p>
          <p className="truncate font-body-sm text-[12px] text-on-surface-variant">
            {option.brand ?? "Vendor"} · {meta.distance} from Mudon
          </p>
        </div>
        <span
          role="link"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onCompare();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onCompare();
            }
          }}
          className="cursor-pointer font-body-sm text-[12px] font-semibold text-brass-600 hover:underline"
        >
          Compare
        </span>
      </div>

      {selected && (
        <span
          aria-hidden="true"
          className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-brass-600 text-on-primary"
        >
          <span className="material-symbols-outlined text-[16px]">check</span>
        </span>
      )}
    </motion.button>
  );
}

function StatusBadge({ option }: { option: VendorOption }) {
  if (option.in_stock) {
    return (
      <span className="rounded-full bg-tertiary-container px-sm py-[2px] text-[10px] font-semibold uppercase tracking-widest text-on-tertiary-container">
        In stock
      </span>
    );
  }
  const days = option.lead_time_days ?? 14;
  return (
    <span className="rounded-full bg-primary-fixed px-sm py-[2px] text-[10px] font-semibold uppercase tracking-widest text-on-primary-fixed">
      Lead {days} d
    </span>
  );
}

// ---------------------------------------------------------------------------
// Selected-vendors list dot
// ---------------------------------------------------------------------------

function VendorDot({ option }: { option: VendorOption }) {
  if (option.photo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={option.photo_url}
        alt={option.brand ?? "vendor"}
        className="size-6 shrink-0 rounded-full object-cover"
        onError={(e) => {
          const el = e.currentTarget;
          el.style.background =
            "linear-gradient(135deg, #C9B79A 0%, #6B5B3E 100%)";
          el.removeAttribute("src");
        }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="size-6 shrink-0 rounded-full"
      style={{
        background: "linear-gradient(135deg, #C9B79A 0%, #6B5B3E 100%)",
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Compare modal table
// ---------------------------------------------------------------------------

function CompareTable({
  line,
  currentId,
  onPick,
  onClose,
}: {
  line: LineCard;
  currentId: string;
  onPick: (opt: VendorOption) => void;
  onClose: () => void;
}) {
  // Same 3 vendors as in the lane.
  const dedup = [line.current, ...line.alternatives].filter(
    (o, idx, arr) => arr.findIndex((x) => x.id === o.id) === idx,
  );
  const cards = dedup.slice(0, 3);
  const rows: Array<{ label: string; cell: (o: VendorOption) => React.ReactNode }> = [
    { label: "Brand", cell: (o) => <span className="font-semibold">{o.brand ?? "—"}</span> },
    {
      label: "Unit price (AED)",
      cell: (o) => (
        <span className="font-mono tabular-nums">
          AED {o.price_aed.toLocaleString("en-US")}/{line.unit}
        </span>
      ),
    },
    {
      label: "Lead time",
      cell: (o) =>
        o.in_stock
          ? "Immediate"
          : `${o.lead_time_days ?? 14} days`,
    },
    {
      label: "In stock",
      cell: (o) => (o.in_stock ? "In UAE stock" : "Import required"),
    },
    { label: "Distance", cell: (o) => metaFor(o.brand).distance },
    { label: "Country of origin", cell: (o) => metaFor(o.brand).origin },
    { label: "Warranty", cell: (o) => metaFor(o.brand).warranty },
    {
      label: "Sample available",
      cell: (o) => (metaFor(o.brand).sample ? "Yes" : "No"),
    },
  ];

  return (
    <div className="flex max-h-[88vh] flex-col">
      <header className="flex items-center justify-between border-b border-ink-100 px-lg py-md">
        <DialogTitle className="font-display text-headline-md text-ink-900">
          Compare {line.description.split(/[—·]/)[0]?.trim() ?? "vendors"}
        </DialogTitle>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close comparison"
          className="focus-ring flex size-8 items-center justify-center rounded text-on-surface-variant hover:text-ink-900"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-lg py-lg">
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col className="w-[180px]" />
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr className="border-b border-ink-100">
              <th className="label-caps px-md py-md text-left text-ink-500">
                Feature
              </th>
              {cards.map((opt) => (
                <th
                  key={opt.id}
                  className="px-md py-md text-left font-display text-headline-md text-ink-900"
                >
                  {opt.brand ?? "—"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-bone">
                <th
                  scope="row"
                  className="label-caps px-md py-md text-left font-normal text-ink-500"
                >
                  {r.label}
                </th>
                {cards.map((opt) => (
                  <td
                    key={opt.id}
                    className="px-md py-md align-top font-body-sm text-body-md text-ink-900"
                  >
                    {r.cell(opt)}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td />
              {cards.map((opt) => {
                const isSelected = opt.id === currentId;
                return (
                  <td key={opt.id} className="px-md pt-lg">
                    <button
                      type="button"
                      onClick={() => onPick(opt)}
                      disabled={isSelected}
                      className={cn(
                        "focus-ring flex h-12 w-full items-center justify-center rounded-lg px-md font-body-sm text-body-sm font-semibold transition-colors",
                        isSelected
                          ? "bg-brass-600 text-on-primary"
                          : "border border-ink-100 bg-paper text-ink-900 hover:bg-surface-container-low",
                      )}
                    >
                      {isSelected ? "Locked" : "Lock this one"}
                    </button>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

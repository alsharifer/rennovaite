"use client";

// =============================================================================
// components/blueprint/boq/ProvenancePopover.tsx — the provenance popover
// (R7 §2 12:336, §4.2 #2).
//
// Opens on hover (250 ms, set by the grid) AND on keyboard focus of a figure
// cell; stays open while the pointer is on it (WCAG 1.4.13); Escape closes it
// (the grid owns the key). role="tooltip", wired from the cell with
// aria-describedby. 320 wide, below and right-aligned to the cell, flipped
// above within 360 px of the viewport bottom — and never over the selected
// row, so it never hides the line the inspector is about.
//
// CONTENT IS THE CURATED PROVENANCE ONLY: the line's I4 chains (built on the
// server from the identity-curated BoQ) and its tierOf() marks. Nothing here
// reads a raw source field.
// =============================================================================

import { useLayoutEffect, useRef, useState } from "react";

import { formatAED, formatQty } from "@/lib/format/aed";
import type { ReviewLine } from "@/lib/boq/review-types";
import { tierLabelWithWhy, type FigureRole } from "@/lib/provenance/tier-vocab";
import type { FigureProvenance } from "@/lib/provenance/types";

import { ProvenanceMark } from "../ProvenanceMark";

export const POPOVER_ID = "bp-boq-provenance";

export interface PopoverTarget {
  line: ReviewLine;
  role: FigureRole;
  /** The figure cell's box (viewport coordinates). */
  rect: { top: number; bottom: number; left: number; right: number };
  /** The selected row's box, if any — the popover never covers it. */
  avoid: { top: number; bottom: number } | null;
}

const WIDTH = 320;
const FLIP_WITHIN = 360;

/** The first geometry / take-off step of a quantity chain, in a few words. */
function quantitySummary(p: FigureProvenance | undefined): string | null {
  if (!p) return null;
  const s = p.steps.find((x) => x.kind === "geometry") ?? p.steps.find((x) => x.kind === "rule" && x.label === "Take-off");
  return s ? `${s.label}${s.detail ? ` · ${s.detail}` : ""}` : null;
}

function rateSummary(p: FigureProvenance | undefined): string | null {
  if (!p) return null;
  const src = p.steps.find((x) => x.kind === "source");
  const tier = p.steps.find((x) => x.kind === "tier");
  return src?.detail ?? tier?.detail ?? null;
}

export function weakerSentence(line: ReviewLine): string {
  const { qty, rate, amount } = line.tiers;
  if (line.unpriced) return "To be priced — not in any total.";
  if (qty === rate) return `Quantity and rate are both ${tierLabelWithWhy(qty, null, "firm", "qty").toLowerCase()}.`;
  const weak = amount === qty ? "quantity" : "rate";
  const why = weak === "quantity" ? line.tiers.qtyWhy : line.tiers.rateWhy;
  return `Amount takes the weaker input: ${weak} is ${tierLabelWithWhy(amount, null, "firm").toLowerCase()}${why && !why.startsWith(weak) ? ` (${why})` : ""}.`;
}

export function ProvenancePopover({ target, onPointerEnter, onPointerLeave }: { target: PopoverTarget; onPointerEnter: () => void; onPointerLeave: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const { line, role, rect, avoid } = target;

  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 200;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = Math.min(Math.max(8, rect.right - WIDTH), vw - WIDTH - 8);
    let top = vh - rect.bottom < FLIP_WITHIN ? rect.top - h - 6 : rect.bottom + 6;
    // Never over the selected row.
    if (avoid && top < avoid.bottom && top + h > avoid.top) top = top < avoid.top ? avoid.top - h - 6 : avoid.bottom + 6;
    top = Math.max(8, Math.min(top, vh - h - 8));
    if (!Number.isFinite(left)) left = 8;
    setPos({ top, left });
  }, [rect, avoid]);

  const tier = role === "qty" ? line.tiers.qty : role === "rate" ? line.tiers.rate : line.tiers.amount;
  const why = role === "qty" ? line.tiers.qtyWhy : role === "rate" ? line.tiers.rateWhy : null;
  const chain = role === "qty" ? line.prov?.quantity : role === "rate" ? line.prov?.rate : line.prov?.total;
  const qSum = quantitySummary(line.prov?.quantity);
  const rSum = rateSummary(line.prov?.rate);
  const flags = chain?.flags ?? [];

  return (
    <div
      ref={ref}
      id={POPOVER_ID}
      role="tooltip"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className="bp-boq-popover fixed z-50 w-[320px] border border-bp-line-strong bg-bp-surface-raised p-4 text-bp-ink-primary"
      style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden", top: 0, left: 0 }}
      data-popover-for={`${line.ref}:${role}`}
    >
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-bp-line-hairline pb-2">
        <span className="inline-flex items-center gap-1.5">
          <ProvenanceMark tier={tier} />
          <span className="t-label-caps">{tierLabelWithWhy(tier, why, "firm", role)}</span>
        </span>
        <span className="t-label-md text-bp-ink-tertiary">
          {line.ref} · {role === "qty" ? "QUANTITY" : role === "rate" ? "RATE" : "AMOUNT"}
        </span>
      </div>

      {line.unpriced ? (
        <p className="t-body-sm text-bp-ink-secondary">To be priced{line.unpricedReason ? ` — ${line.unpricedReason}` : ""}. Not in any total.</p>
      ) : role === "amount" ? (
        <>
          <p className="t-num-sm flex flex-wrap items-center gap-1.5">
            <span>
              {formatQty(line.quantity)} {line.unit}
            </span>
            <ProvenanceMark tier={line.tiers.qty} />
            <span className="text-bp-ink-tertiary">×</span>
            <span>{formatAED(line.rate)}</span>
            <ProvenanceMark tier={line.tiers.rate} />
            <span className="text-bp-ink-tertiary">=</span>
            <span>{formatAED(line.amount)}</span>
          </p>
          <p className="t-body-sm mt-2 text-bp-ink-secondary">{weakerSentence(line)}</p>
        </>
      ) : (
        <p className="t-num-sm">{role === "qty" ? `${formatQty(line.quantity)} ${line.unit}` : `${formatAED(line.rate)} / ${line.unit}`}</p>
      )}

      <dl className="t-label-md mt-3 grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2">
        {qSum ? (
          <>
            <dt className="text-bp-ink-tertiary">QUANTITY</dt>
            <dd className="text-bp-ink-primary">{qSum}</dd>
          </>
        ) : null}
        {rSum ? (
          <>
            <dt className="text-bp-ink-tertiary">RATE</dt>
            <dd className="text-bp-ink-primary">{rSum}</dd>
          </>
        ) : null}
        {flags.length > 0 ? (
          <>
            <dt className="text-bp-ink-tertiary">FLAGS</dt>
            <dd className="text-bp-ink-primary">{flags.join(" · ")}</dd>
          </>
        ) : null}
        {chain && !chain.traceable ? (
          <>
            <dt className="text-bp-ink-tertiary">GAP</dt>
            <dd className="text-bp-ink-primary" data-provenance="gap">
              {chain.gap ?? "not traceable to a source"}
            </dd>
          </>
        ) : null}
      </dl>
      <p className="t-label-md mt-3 text-bp-ink-tertiary">Enter or click the line to open the inspector</p>
    </div>
  );
}

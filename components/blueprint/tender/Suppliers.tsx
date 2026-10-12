"use client";

// =============================================================================
// components/blueprint/tender/Suppliers.tsx — 06 Tender · Contractors &
// suppliers (K8 #8, spec §6.7, Figma 60:913).
//
// The table: each major item (section caps, title, quantity) · the chosen
// supplier (a check + its catalogue name, stock as plain text) · the
// catalogue rate with its market mark · "N more" + swap, which opens the
// item's other suppliers in place. The summary: the live total in the
// stored-headline convention (≈ … * + the BoQ's weakest mark), the change
// against the choices the page opened with — in ink, with a sign, never a
// status hue — the selected suppliers, and the one Primary, "Send scope to
// contractors", disabled with its reason while the rail holds Tender blocked.
//
// A choice is saved as it is made (POST /api/vendor-selections) and priced
// through the SHARED chain (lib/boq/totals.ts), so the live total cannot
// drift from the arithmetic a BoQ stores. It is a scenario on the stored
// revision: generating a BoQ does not read these choices.
// =============================================================================

import { useMemo, useRef, useState } from "react";

import { AnalyticsEvent, track } from "@/lib/analytics";
import { lineTotal, money2 } from "@/lib/boq/money";
import { chainTotals } from "@/lib/boq/totals";
import { formatAED, formatDelta, formatQty, headlineSpokenText } from "@/lib/format/aed";
import { describeFigure, type ProvTier } from "@/lib/provenance/tier-vocab";

import { Button } from "../Button";
import { Icon } from "../Icon";
import { ProvenanceMark } from "../ProvenanceMark";
import { displayUnit } from "../boq/format";

export type SupplierOption = {
  id: string;
  /** The catalogue's supplier name (pricing_skus.brand). */
  brand: string | null;
  price_aed: number;
  lead_time_days: number | null;
  in_stock: boolean | null;
};

export type SupplierLine = {
  /** `${work_section}-${idx}` over the stored section order — the key vendor_selections persists. */
  line_key: string;
  work_section: string;
  description: string;
  quantity: number;
  unit: string;
  base_total_aed: number;
  current: SupplierOption;
  alternatives: SupplierOption[];
};

export type SuppliersBoq = {
  boq_id: string;
  rev: number | null;
  contingency_pct: number;
  vat_pct: number;
  ohp_pct?: number;
  base_subtotal_aed: number;
  /** The stored grand total and its headline convention (lib/hub/estimate). */
  stored_grand_aed: number;
  estimate: boolean;
  excluded: number;
  tier: ProvTier | null;
};

/** Rows shown before "Show all" — the largest share of cost first (frame 60:913). */
const FIRST_ROWS = 6;

const supplierName = (o: SupplierOption) => o.brand ?? "Catalogue supplier";

/** Stock as plain text — never a badge, never a hue. */
function stockText(o: SupplierOption): string {
  if (o.in_stock) return "In stock";
  if (o.lead_time_days != null) return `Lead time ${o.lead_time_days} days`;
  return o.in_stock === false ? "Made to order" : "Stock not listed";
}

function Rate({ o, unit }: { o: SupplierOption; unit: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden="true" className="t-num-sm text-bp-ink-primary">
        {formatAED(o.price_aed)} /{displayUnit(unit)}
      </span>
      <ProvenanceMark tier="market" />
      <span className="sr-only">{describeFigure(`AED ${formatAED(o.price_aed)} per ${displayUnit(unit)}`, "market", { persona: "owner", role: "rate" })}</span>
    </span>
  );
}

export function Suppliers({
  projectId,
  boq,
  lines,
  sendBlocked,
  documentsHref,
}: {
  projectId: string;
  boq: SuppliersBoq;
  lines: SupplierLine[];
  /** The rail's Tender block, in the button's words — null when Tender is open. */
  sendBlocked: string | null;
  documentsHref: string | null;
}) {
  const [selection, setSelection] = useState<Record<string, SupplierOption>>(() => Object.fromEntries(lines.map((l) => [l.line_key, l.current])));
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(lines.length <= FIRST_ROWS);
  const [sent, setSent] = useState(false);
  const sentRef = useRef<HTMLDivElement>(null);

  // Base subtotal + Σ (chosen line − stored line), then the shared chain.
  const grandOf = (sel: Record<string, SupplierOption>) => {
    let delta = 0;
    for (const l of lines) delta = money2(delta + lineTotal(l.quantity, (sel[l.line_key] ?? l.current).price_aed) - l.base_total_aed);
    return chainTotals({ subtotal_aed: boq.base_subtotal_aed + delta, contingency_pct: boq.contingency_pct, vat_pct: boq.vat_pct, ohp_pct: boq.ohp_pct }).grand_total_aed;
  };
  const [opening] = useState(() => grandOf(selection));
  const grand = useMemo(() => grandOf(selection), [selection]); // eslint-disable-line react-hooks/exhaustive-deps
  const change = money2(grand - opening);

  function pick(line: SupplierLine, opt: SupplierOption) {
    const prev = selection[line.line_key] ?? line.current;
    if (prev.id === opt.id) return;
    setSelection((s) => ({ ...s, [line.line_key]: opt }));
    track(AnalyticsEvent.VendorSwapped, { project_id: projectId, boq_id: boq.boq_id, boq_line_id: line.line_key, sku_id: opt.id });
    fetch("/api/vendor-selections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        boq_id: boq.boq_id,
        boq_line_id: line.line_key,
        sku_id: opt.id,
        from_sku_id: prev.id,
        delta_aed: money2(lineTotal(line.quantity, opt.price_aed) - lineTotal(line.quantity, prev.price_aed)),
      }),
    }).catch((err) => console.warn("[suppliers] save error:", err));
  }

  // The selected suppliers, grouped: name · the sections they supply · N items.
  const chosen = useMemo(() => {
    const by = new Map<string, { name: string; sections: string[]; lines: SupplierLine[] }>();
    for (const l of lines) {
      const o = selection[l.line_key] ?? l.current;
      const name = supplierName(o);
      const g = by.get(name) ?? { name, sections: [], lines: [] };
      if (!g.sections.includes(l.work_section)) g.sections.push(l.work_section);
      g.lines.push(l);
      by.set(name, g);
    }
    return [...by.values()];
  }, [lines, selection]);

  const rows = showAll ? lines : lines.slice(0, FIRST_ROWS);
  const headline = `${boq.estimate ? "≈ " : ""}AED ${formatAED(grand)}${boq.excluded ? "*" : ""}`;
  const reasonId = "send-scope-reason";

  return (
    <div className="grid grid-cols-1 gap-8 min-[1400px]:grid-cols-[minmax(0,1fr)_320px]">
      <section aria-labelledby="items-h">
        <h2 id="items-h" className="sr-only">
          Items and their suppliers
        </h2>
        <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_180px_160px_88px] gap-4 bg-bp-surface-sunken px-3 py-2.5 lg:grid">
          <span className="t-label-caps text-bp-ink-tertiary">ITEM</span>
          <span className="t-label-caps text-bp-ink-tertiary">CHOSEN SUPPLIER</span>
          <span className="t-label-caps text-right text-bp-ink-tertiary">RATE · AED</span>
          <span />
        </div>
        <ul>
          {rows.map((l) => {
            const o = selection[l.line_key] ?? l.current;
            const others = [l.current, ...l.alternatives].filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i && x.id !== o.id);
            const panel = `swap-${l.line_key.replace(/[^a-zA-Z0-9]+/g, "-")}`;
            const expanded = open === l.line_key;
            return (
              <li key={l.line_key} className="border-b border-bp-line-hairline" data-supplier-line={l.line_key}>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-3 py-3.5 lg:grid-cols-[minmax(0,1fr)_180px_160px_88px]">
                  <div className="col-span-2 lg:col-span-1">
                    <p className="t-label-caps text-bp-ink-tertiary">{l.work_section}</p>
                    <p className="t-body-sm mt-1 font-semibold text-bp-ink-primary">{l.description}</p>
                    <p className="t-num-sm mt-0.5 text-bp-ink-tertiary">
                      {formatQty(l.quantity)} {displayUnit(l.unit)}
                    </p>
                  </div>
                  <div>
                    <p className="t-body-sm flex items-center gap-1.5 font-semibold text-bp-ink-primary">
                      <Icon name="check" className="text-[18px]" />
                      <span className="sr-only">Chosen: </span>
                      {supplierName(o)}
                    </p>
                    <p className="t-body-sm text-bp-ink-secondary">{stockText(o)}</p>
                  </div>
                  <p className="text-right">
                    <Rate o={o} unit={l.unit} />
                  </p>
                  <div className="col-span-2 lg:col-span-1 lg:text-right">
                    {others.length ? (
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={panel}
                        onClick={() => setOpen(expanded ? null : l.line_key)}
                        className="t-body-sm inline-flex items-center gap-1.5 text-bp-ink-secondary hover:text-bp-ink-primary"
                      >
                        {others.length} more
                        <Icon name="swap_horiz" className="text-[18px]" />
                        <span className="sr-only">suppliers for {l.description}</span>
                      </button>
                    ) : (
                      <span className="t-label-md whitespace-nowrap font-bp-mono text-bp-ink-tertiary">only supplier</span>
                    )}
                  </div>
                </div>
                {others.length ? (
                  <div id={panel} hidden={!expanded} className="border-t border-bp-line-hairline bg-bp-surface-raised px-3 py-2">
                    <p className="t-label-caps py-1.5 text-bp-ink-tertiary">OTHER SUPPLIERS FOR THIS ITEM</p>
                    <ul>
                      {others.map((x) => {
                        const d = money2(lineTotal(l.quantity, x.price_aed) - lineTotal(l.quantity, o.price_aed));
                        return (
                          <li key={x.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-t border-bp-line-hairline py-2.5 first:border-t-0 lg:grid-cols-[minmax(0,1fr)_180px_160px_88px]">
                            <span className="t-body-sm text-bp-ink-primary">
                              {supplierName(x)}
                              <span className="block text-bp-ink-secondary">{stockText(x)}</span>
                            </span>
                            <span className="t-num-sm text-bp-ink-secondary">
                              {d === 0 ? "same cost" : `${formatDelta(d).replace(/^([+−])/, "$1AED ")} on this item`}
                            </span>
                            <span className="text-right">
                              <Rate o={x} unit={l.unit} />
                            </span>
                            <span className="lg:text-right">
                              <Button kind="secondary" onClick={() => { pick(l, x); setOpen(null); }} aria-label={`Choose ${supplierName(x)} for ${l.description}`}>
                                Choose
                              </Button>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="t-label-md mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-bp-mono text-bp-ink-tertiary">
          <span>
            Showing {rows.length} of {lines.length} · largest share of cost first
          </span>
          {lines.length > FIRST_ROWS ? (
            <Button kind="quiet" onClick={() => setShowAll(!showAll)}>
              {showAll ? `Show the first ${FIRST_ROWS}` : `Show all ${lines.length}`}
            </Button>
          ) : null}
        </p>
      </section>

      <aside aria-labelledby="live-h" className="h-fit border border-bp-line-hairline p-4 min-[1400px]:sticky min-[1400px]:top-[calc(var(--bp-topbar-h)+24px)]" data-live-total={grand}>
        <h2 id="live-h" className="t-label-caps text-bp-ink-tertiary">
          LIVE TOTAL · INCL. VAT
        </h2>
        <p className="mt-1.5 flex items-center gap-2.5">
          <span aria-hidden="true" className="t-num-lg text-bp-ink-primary">
            {headline}
          </span>
          {boq.tier ? <ProvenanceMark tier={boq.tier} /> : null}
          <span className="sr-only">{headlineSpokenText(grand, { estimate: boq.estimate, excludedLines: boq.excluded })}</span>
        </p>
        <p className="t-num-sm mt-1.5 text-bp-ink-secondary" aria-live="polite">
          {change === 0 ? "No change from your previous choices" : `${formatDelta(change).replace(/^([+−])/, "$1AED ")} vs your previous choices`}
        </p>
        <p className="t-body-sm mt-2 text-bp-ink-tertiary">
          Your choices are saved as you make them. They are a scenario on {boq.rev ? `BoQ rev ${boq.rev}` : "the BoQ"}, which stays at AED {formatAED(boq.stored_grand_aed)}
          {boq.excluded ? "*" : ""}.
        </p>

        <h3 className="t-label-caps mt-5 text-bp-ink-tertiary">SELECTED SUPPLIERS · {chosen.length}</h3>
        <ul className="mt-1">
          {chosen.map((g) => {
            const moved = g.lines.filter((l) => (selection[l.line_key] ?? l.current).id !== l.current.id);
            return (
              <li key={g.name} className="flex items-start gap-3 border-b border-bp-line-hairline py-3">
                <span className="min-w-0 flex-1">
                  <span className="t-body-sm block font-semibold text-bp-ink-primary">{g.name}</span>
                  <span className="t-body-sm block text-bp-ink-secondary">
                    {g.sections.join(", ")}
                    {g.lines.length > 1 ? ` · ${g.lines.length} items` : ""}
                  </span>
                </span>
                {moved.length ? (
                  <button
                    type="button"
                    onClick={() => moved.forEach((l) => pick(l, l.current))}
                    aria-label={`Undo choosing ${g.name} (${moved.length} item${moved.length === 1 ? "" : "s"})`}
                    className="text-bp-ink-secondary hover:text-bp-ink-primary"
                  >
                    <Icon name="close" className="text-[18px]" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>

        <div className="mt-4 flex flex-col gap-2">
          <Button
            kind="primary"
            disabled={sendBlocked ? { reason: sendBlocked, reasonId } : false}
            onClick={() => {
              track(AnalyticsEvent.SentToContractor, { project_id: projectId, boq_id: boq.boq_id, vendor_count: chosen.length });
              setSent(true);
              requestAnimationFrame(() => sentRef.current?.focus());
            }}
            className="self-start"
          >
            Send scope to contractors
          </Button>
          {sendBlocked ? (
            <p className="t-body-sm flex items-start gap-2 text-bp-ink-secondary">
              <Icon name="lock" className="text-[18px]" />
              <span id={reasonId}>{sendBlocked}</span>
            </p>
          ) : null}
        </div>
        {sent ? (
          <div ref={sentRef} tabIndex={-1} role="status" className="mt-4 bg-bp-surface-sunken p-3" data-send-scope>
            <p className="t-body-sm font-semibold text-bp-ink-primary">Your scope is ready to share</p>
            <p className="t-body-sm mt-1 text-bp-ink-secondary">
              Download the tender pack and send it to the contractors you choose — it is built to be bid against as it stands. Inviting contractors from RenovAIte is not built yet.
            </p>
            {documentsHref ? (
              <Button kind="quiet" href={documentsHref} className="mt-1">
                Open documents
              </Button>
            ) : null}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

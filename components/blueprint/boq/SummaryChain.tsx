// =============================================================================
// components/blueprint/boq/SummaryChain.tsx — the summary chain at the end of
// the table, and the lines NOT in it (R7 §3.2, 13:48 bottom).
//
// Subtotal — N counted lines (weakest mark) · OH&P (x% from your book, or "not
// applied" with the reason) · Contingency x% × base · VAT y% × base · Project
// total. Every figure is the STORED one (H7: each rounded once, to the fil;
// the base printed is the base it was charged on). Then the "* NOT IN THE
// TOTAL — TO BE PRICED" list: REF, quantity and the reason — named, never a
// silent zero (D4).
// =============================================================================

import { formatAED, formatQty } from "@/lib/format/aed";
import type { ReviewModel } from "@/lib/boq/review-types";
import { OHP_LINE_LABEL } from "@/lib/rates/ohp";

import { Figure } from "../Figure";
import { ProvenanceMark } from "../ProvenanceMark";
import { displayUnit } from "./format";

export const SUMMARY_ID = "boq-summary";

function Row({ label, note, children, strong, data }: { label: string; note?: string; children: React.ReactNode; strong?: boolean; data: Record<string, string> }) {
  return (
    <div className={`flex items-center gap-6 border-b border-bp-line-hairline px-4 py-3 ${strong ? "border-t-2 border-t-bp-line-strong" : ""}`} {...data}>
      <span className={`flex-1 ${strong ? "t-heading-sm" : "t-body-sm"} text-bp-ink-primary`}>{label}</span>
      {note ? <span className="t-label-md text-bp-ink-tertiary">{note}</span> : null}
      <span className="min-w-[136px] text-right">{children}</span>
    </div>
  );
}

export function SummaryChain({ model }: { model: ReviewModel }) {
  const c = model.chain;
  const h = model.headline;
  const star = h.excluded.length > 0;
  return (
    <section id={SUMMARY_ID} tabIndex={-1} aria-label="Summary and totals" className="mt-8 outline-none">
      <div className="border-t border-bp-line-strong">
        <Row label={`Subtotal — ${model.counted} counted line${model.counted === 1 ? "" : "s"}`} data={{ "data-summary-row": "subtotal" }}>
          {c.subtotalTier ? <Figure value={c.subtotal} tier={c.subtotalTier} persona={model.persona} /> : <span className="t-num-md">{formatAED(c.subtotal)}</span>}
        </Row>
        {c.ohp ? (
          <Row label={OHP_LINE_LABEL} note={`${c.ohp.pct}% × ${formatAED(c.ohp.base)} · from your book`} data={{ "data-summary-row": "ohp", "data-ohp-line": "true" }}>
            <span className="t-num-md text-bp-ink-primary">{formatAED(c.ohp.amount)}</span>
          </Row>
        ) : (
          <Row label="OH&P" note={c.ohpNote ?? undefined} data={{ "data-summary-row": "ohp" }}>
            <span className="t-label-md text-bp-ink-tertiary">not applied</span>
          </Row>
        )}
        <Row label="Contingency" note={`${c.contingency.pct}% × ${formatAED(c.contingency.base)}`} data={{ "data-summary-row": "contingency" }}>
          <span className="t-num-md text-bp-ink-primary">{formatAED(c.contingency.amount)}</span>
        </Row>
        <Row label="VAT" note={`${c.vat.pct}% × ${formatAED(c.vat.base)}`} data={{ "data-summary-row": "vat" }}>
          <span className="t-num-md text-bp-ink-primary">{formatAED(c.vat.amount)}</span>
        </Row>
        <Row label="Project total" strong data={{ "data-summary-row": "total", "data-chain-total": String(c.grand) }}>
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="t-num-lg text-bp-ink-primary">
              {h.estimate ? "≈ " : ""}
              {formatAED(c.grand)}
              {star ? "*" : ""}
            </span>
            {h.tier ? <ProvenanceMark tier={h.tier} /> : null}
            <span className="sr-only">{h.spoken}</span>
          </span>
        </Row>
      </div>

      {star ? (
        <div className="mt-6 px-4" data-unpriced-lines="true">
          <p className="t-label-caps text-bp-ink-tertiary">* NOT IN THE TOTAL — TO BE PRICED</p>
          <ul className="mt-2 space-y-1">
            {h.excluded.map((x) => (
              <li key={x.ref} className="t-label-md text-bp-ink-secondary">
                <span className="text-bp-ink-primary">{x.ref}</span>&nbsp;&nbsp;{x.description} — {formatQty(x.quantity)} {displayUnit(x.unit)} · {x.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

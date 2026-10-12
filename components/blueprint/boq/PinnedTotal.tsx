// =============================================================================
// components/blueprint/boq/PinnedTotal.tsx — the pinned total bar (R7 §3.2,
// 13:48 top; phone 26:924 compact).
//
// PROJECT TOTAL · INCL. CONTINGENCY x% + VAT y% · "≈ AED N*" + the weakest
// counted mark · "* excludes K lines to be priced — REF, REF…" (named, D4) ·
// right: the basis of the subtotal by tier. The headline is the STORED total
// (a what-if is a scenario, never the BoQ); screen readers hear "approximately
// AED …, excludes 3 lines to be priced" — never "star" (§4.2 #12).
// =============================================================================

import { formatAED } from "@/lib/format/aed";
import type { ReviewModel } from "@/lib/boq/review-types";
import { tierLabel } from "@/lib/provenance/tier-vocab";

import { ProvenanceMark } from "../ProvenanceMark";
import { linesWord } from "./format";

export function PinnedTotal({ model }: { model: ReviewModel }) {
  const h = model.headline;
  const c = model.chain;
  const star = h.excluded.length > 0;
  const parts = [`CONTINGENCY ${c.contingency.pct}%`, `VAT ${c.vat.pct}%`];
  if (c.ohp) parts.unshift(`OH&P ${c.ohp.pct}%`);
  return (
    <section aria-label="Project total" className="bp-boq-pinned border-b border-bp-line-strong bg-bp-surface-base px-6 py-5 md:px-8">
      <div className="flex flex-wrap items-start justify-between gap-x-12 gap-y-4">
        <div className="min-w-0">
          <p className="t-label-caps text-bp-ink-tertiary">
            PROJECT TOTAL · INCL. {parts.join(" + ")}
          </p>
          <p className="mt-1 flex items-center gap-2" data-display-total={h.total} {...(h.estimate ? { "data-derived-total": "true" } : {})}>
            <span aria-hidden="true" className="t-num-xl text-bp-ink-primary">
              {h.estimate ? "≈ " : ""}AED {formatAED(h.total)}
              {star ? "*" : ""}
            </span>
            {h.tier ? <ProvenanceMark tier={h.tier} /> : null}
            <span className="sr-only">
              {h.spoken}
              {h.tier ? `, ${tierLabel(h.tier, model.persona).toLowerCase()}` : ""}
            </span>
          </p>
          {star ? (
            <p className="t-label-md mt-1 text-bp-ink-secondary" data-headline-excludes="true">
              * excludes {linesWord(h.excluded.length)} to be priced<span className="bp-boq-pinned-meta"> — {h.excluded.map((x) => x.ref).join(", ")}</span>
            </p>
          ) : (
            <p className="bp-boq-pinned-meta t-label-md mt-1 text-bp-ink-secondary">
              {model.counted} of {model.totalLines} lines priced · subtotal {formatAED(c.subtotal)}
              {c.ohp ? ` · OH&P ${formatAED(c.ohp.amount)}` : ""} · contingency {formatAED(c.contingency.amount)} · VAT {formatAED(c.vat.amount)}
            </p>
          )}
          {model.budget != null ? (
            <p className="bp-boq-pinned-meta t-label-md mt-1 text-bp-ink-tertiary" data-budget-headline="shown">
              Client budget AED {formatAED(model.budget)} · {model.budget - h.total >= 0 ? "headroom" : "over by"} AED {formatAED(Math.abs(model.budget - h.total))}
            </p>
          ) : null}
        </div>

        <div className="bp-boq-pinned-meta min-w-[300px]">
          <p className="t-label-caps text-bp-ink-tertiary">BASIS OF SUBTOTAL {formatAED(c.subtotal)}</p>
          <table className="mt-1">
            <caption className="sr-only">Counted lines by provenance tier</caption>
            <tbody>
              {model.basis.map((b) => (
                <tr key={b.tier} className="h-6">
                  <th scope="row" className="pr-6 text-left font-normal">
                    <span className="inline-flex items-center gap-2">
                      <ProvenanceMark tier={b.tier} />
                      <span className={`t-body-sm ${b.tier === "unpriced" ? "text-bp-ink-tertiary" : "text-bp-ink-primary"}`}>{tierLabel(b.tier, model.persona)}</span>
                    </span>
                  </th>
                  <td className="t-label-md pr-6 text-bp-ink-tertiary">{linesWord(b.lines)}</td>
                  <td className="t-num-sm text-right text-bp-ink-primary">{b.tier === "unpriced" ? "—" : formatAED(b.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

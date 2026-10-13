// =============================================================================
// components/blueprint/hub/HubScreen.tsx — 00 Project hub for a firm project
// (K5a, R7 §3.1, Figma 11:48). Server-safe (no hooks): every figure arrives as
// data from lib/hub/hub-view.ts.
//
// Header (PROJECT HUB · name in display/serif · meta) · the estimate with its
// weakest mark and named exclusions, and the "Basis of this number" table that
// adds up to it · Next (the rail's own attention / blocked steps, max 3) ·
// Revisions (diff counts, recorded causes, status) + reconciliation ·
// Documents (ready / locked + why). Empty: no BoQ → StateBlock Empty in the
// estimate slot. Tablet: one column; the revisions table drops Date + Total.
// =============================================================================

import type { ReactNode } from "react";
import { formatAED, formatDelta, headlineSpokenText } from "@/lib/format/aed";
import type { HubView } from "@/lib/hub/hub-view";
import { tierLabel } from "@/lib/provenance/tier-vocab";

import { Button } from "../Button";
import { Icon } from "../Icon";
import { ProvenanceMark } from "../ProvenanceMark";
import { StateBlock } from "../StateBlock";

export function HubScreen({ view, files }: { view: HubView; /** K10 #9: the project's files, under Documents in the page's column. */ files?: ReactNode }) {
  const e = view.estimate;
  return (
    <div className="mx-auto max-w-[1344px] px-6 py-10 pb-16 lg:px-16" data-hub>
      <p className="t-label-caps text-bp-brass-text">PROJECT HUB</p>
      <h1 className="t-display-serif mt-3 text-bp-ink-primary">{view.name}</h1>
      {view.meta.length ? <p className="t-label-md mt-2 font-bp-mono text-bp-ink-secondary">{view.meta.join(" · ")}</p> : null}

      <div className="mt-10 grid grid-cols-1 gap-12 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section aria-labelledby="estimate-h" className="min-w-0">
          {e ? (
            <>
              <h2 id="estimate-h" className="t-label-caps text-bp-ink-tertiary">
                ESTIMATE · REV {e.rev} · {e.revDate.toUpperCase()} · INCL. CONTINGENCY AND VAT
              </h2>
              <p className="mt-3 flex items-center gap-3" data-hub-estimate={e.grand}>
                <span aria-hidden="true" className="t-num-xl text-bp-ink-primary">
                  {e.estimate ? "≈ " : ""}AED {formatAED(e.grand)}
                  {e.excluded.length ? "*" : ""}
                </span>
                {e.tier ? <ProvenanceMark tier={e.tier} /> : null}
                <span className="sr-only">
                  {headlineSpokenText(e.grand, { estimate: e.estimate, excludedLines: e.excluded.length })}
                  {e.tier ? `, ${tierLabel(e.tier)}` : ""}
                </span>
              </p>
              {e.excluded.length ? (
                <p className="t-label-md mt-2 font-bp-mono text-bp-ink-secondary">
                  * excludes {e.excluded.length} line{e.excluded.length === 1 ? "" : "s"} to be priced: {e.excluded.map((x) => `${x.ref} ${x.description}`).join(", ")}
                </p>
              ) : null}
              {e.budget != null ? (
                <p className="t-body-sm mt-2 text-bp-ink-secondary" data-hub-budget={e.budget}>
                  Your budget: <span className="t-num-sm text-bp-ink-primary">AED {formatAED(e.budget)}</span> · this estimate is {Math.round((e.grand / e.budget) * 1000) / 10}% of it
                </p>
              ) : null}

              <table className="mt-6 w-full border-collapse" aria-label="Basis of this number" data-testid="hub-basis">
                <thead>
                  <tr className="border-b border-bp-line-strong bg-bp-surface-sunken">
                    <th scope="col" className="t-label-caps px-3 py-2.5 text-left font-normal text-bp-ink-tertiary">BASIS OF THIS NUMBER</th>
                    <th scope="col" className="t-label-caps px-3 py-2.5 text-right font-normal text-bp-ink-tertiary">LINES</th>
                    <th scope="col" className="t-label-caps px-3 py-2.5 text-right font-normal text-bp-ink-tertiary">AED</th>
                    <th scope="col" className="t-label-caps px-3 py-2.5 text-right font-normal text-bp-ink-tertiary">SHARE</th>
                  </tr>
                </thead>
                <tbody>
                  {e.basis.map((b) => (
                    <tr key={b.tier} className="border-b border-bp-line-hairline" data-basis-tier={b.tier}>
                      <th scope="row" className={`t-body-sm px-3 py-3 text-left font-normal ${b.tier === "unpriced" ? "text-bp-ink-tertiary" : "text-bp-ink-primary"}`}>
                        <span className="inline-flex items-center gap-2">
                          <ProvenanceMark tier={b.tier} />
                          {b.tier === "unpriced" ? "To be priced — excluded" : tierLabel(b.tier)}
                        </span>
                      </th>
                      <td className="t-num-md px-3 py-3 text-right text-bp-ink-primary">{b.lines}</td>
                      <td className="t-num-md px-3 py-3 text-right text-bp-ink-primary">{b.amount == null ? "—" : formatAED(b.amount)}</td>
                      <td className="t-num-md px-3 py-3 text-right text-bp-ink-secondary">{b.share == null ? "—" : `${b.share.toFixed(1)}%`}</td>
                    </tr>
                  ))}
                  <tr className="border-b border-bp-line-strong">
                    <th scope="row" className="t-heading-sm px-3 py-3 text-left font-normal text-bp-ink-primary">
                      Counted total
                    </th>
                    <td className="t-num-md px-3 py-3 text-right text-bp-ink-primary">{e.countedLines}</td>
                    <td className="t-num-md px-3 py-3 text-right text-bp-ink-primary" data-basis-total={e.counted}>
                      {formatAED(e.counted)}
                    </td>
                    <td className="t-num-md px-3 py-3 text-right text-bp-ink-secondary">{e.counted ? "100.0%" : "—"}</td>
                  </tr>
                </tbody>
              </table>
              {/* The headline is the counted total carried through the stored chain — to the fil (H7). */}
              <p className="t-label-md mt-2 font-bp-mono text-bp-ink-tertiary" data-testid="hub-chain">
                {formatAED(e.counted)} counted
                {e.chain.ohp ? ` + OH&P ${formatAED(e.chain.ohp)}` : ""} + contingency {e.contingencyPct}% {formatAED(e.chain.contingency)} + VAT {e.vatPct}% {formatAED(e.chain.vat)} = {formatAED(e.grand)}
                {e.counted !== e.chain.subtotal ? ` · the stored subtotal is ${formatAED(e.chain.subtotal)}` : ""}
              </p>
            </>
          ) : (
            <StateBlock
              kind="empty"
              icon="table"
              title="No BoQ yet"
              actions={
                <Button kind="primary" href={`/project/${view.projectId}/boq`}>
                  Open BoQ &amp; Review
                </Button>
              }
            >
              The estimate, its basis and the revision history start with the first BoQ, generated from the plan.
            </StateBlock>
          )}
        </section>

        <section aria-labelledby="next-h" className="min-w-0">
          <h2 id="next-h" className="t-label-caps text-bp-brass-text">
            NEXT
          </h2>
          {view.next.length === 0 ? (
            <p className="t-body-sm mt-3 text-bp-ink-secondary">Nothing is waiting on you: every step that can be done is done or open.</p>
          ) : (
            <ul className="mt-1" data-testid="hub-next">
              {view.next.map((n) => (
                <li key={n.step} className="border-b border-bp-line-hairline py-5">
                  <p className="t-label-caps text-bp-ink-tertiary">{n.step}</p>
                  <p className="t-heading-sm mt-2 text-bp-ink-primary">{n.title}</p>
                  {n.sentence ? <p className="t-body-sm mt-1 text-bp-ink-secondary">{n.sentence}.</p> : null}
                  <div className="mt-3 flex flex-wrap items-center gap-4">
                    {n.primary ? (
                      <Button kind="primary" href={n.primary.href}>
                        {n.primary.label}
                      </Button>
                    ) : null}
                    {n.secondary ? (
                      <Button kind="quiet" href={n.secondary.href}>
                        {n.secondary.label}
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {view.revisions.length ? (
        <section aria-labelledby="revs-h" className="mt-14">
          <h2 id="revs-h" className="t-heading-md text-bp-ink-primary">
            Revisions
          </h2>
          <div className="relative mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Revisions table">
            <table className="w-full min-w-[640px] border-collapse" data-testid="hub-revisions">
              <thead>
                <tr className="border-b border-bp-line-strong bg-bp-surface-sunken">
                  {[
                    ["REV", "text-left", ""],
                    ["DATE", "text-left", "bp-hub-wide"],
                    ["CAUSE", "text-left", ""],
                    ["LINES", "text-right", ""],
                    ["Δ AED", "text-right", ""],
                    ["TOTAL AED", "text-right", "bp-hub-wide"],
                    ["STATUS", "text-left", ""],
                  ].map(([h, a, c]) => (
                    <th key={h} scope="col" className={`t-label-caps whitespace-nowrap px-3 py-2.5 font-normal text-bp-ink-tertiary ${a} ${c}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.revisions.map((r) => (
                  <tr key={r.boqId} className="border-b border-bp-line-hairline" data-rev={r.rev}>
                    <td className="t-num-sm whitespace-nowrap px-3 py-3 text-bp-ink-primary">
                      <a href={`/project/${view.projectId}/boq/revisions?to=${r.boqId}`} className="underline decoration-bp-line-control underline-offset-2 hover:decoration-bp-ink-primary">
                        rev {r.rev}
                      </a>
                    </td>
                    <td className="t-num-sm bp-hub-wide whitespace-nowrap px-3 py-3 text-bp-ink-secondary">{r.date}</td>
                    <td className="t-body-sm px-3 py-3 text-bp-ink-primary">{r.cause}</td>
                    <td className="t-num-sm px-3 py-3 text-right text-bp-ink-primary">{r.lines == null ? "—" : r.lines}</td>
                    <td className="t-num-sm whitespace-nowrap px-3 py-3 text-right text-bp-ink-primary">{r.delta == null ? "—" : formatDelta(r.delta)}</td>
                    <td className="t-num-sm bp-hub-wide whitespace-nowrap px-3 py-3 text-right text-bp-ink-primary">{formatAED(r.total)}</td>
                    <td className="t-label-md whitespace-nowrap px-3 py-3 text-bp-ink-secondary">
                      {r.awaiting ? <Icon name="flag" size={16} className="mr-1 align-[-3px]" /> : null}
                      {r.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {view.reconciliation ? <p className="t-label-md mt-2 font-bp-mono text-bp-ink-tertiary">{view.reconciliation}</p> : null}
        </section>
      ) : null}

      {view.documents.length ? (
        <section aria-labelledby="docs-h" className="mt-14">
          <h2 id="docs-h" className="t-heading-md text-bp-ink-primary">
            Documents
          </h2>
          <ul className="mt-3" data-testid="hub-documents">
            {view.documents.map((d) => (
              <li key={d.key} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 border-b border-bp-line-hairline py-4 md:grid-cols-[24px_minmax(0,1fr)_minmax(0,1.2fr)_auto]" data-document={d.key} data-locked={d.locked}>
                <Icon name={d.icon} size={20} className={d.locked ? "text-bp-ink-tertiary" : "text-bp-ink-secondary"} />
                <span className={`t-body-sm ${d.locked ? "text-bp-ink-tertiary" : "text-bp-ink-primary"}`}>{d.label}</span>
                <span className="t-label-md col-start-2 row-start-2 font-bp-mono text-bp-ink-secondary md:col-start-auto md:row-start-auto">
                  {d.locked ? <Icon name="lock" size={16} className="mr-1 align-[-3px]" /> : null}
                  {d.state}
                </span>
                {d.action ? (
                  <Button kind="quiet" href={d.action.href}>
                    {d.action.label}
                  </Button>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {files}
    </div>
  );
}

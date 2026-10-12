// =============================================================================
// components/blueprint/hub/OwnerOverview.tsx — 00 Overview for an owner
// (K8 #2, spec §6.2, Figma 54:145). The firm journey keeps the firm hub
// (HubScreen, 11:48). Server component: the view arrives built
// (lib/hub/overview-view.ts).
//
// Top bar: when the cost was last worked out · Secondary "3D view". Left: the
// estimate (num/xl + the weakest mark + the exclusions sentence), the client's
// budget as a 2 px ink bar on a hairline track (no brass fill), "What this
// number is based on" in the owner's words, Your design. Right (400): NEXT,
// 05 Timeline, Documents.
// =============================================================================

import Link from "next/link";

import { formatAED, headlineSpokenText } from "@/lib/format/aed";
import type { OverviewView } from "@/lib/hub/overview-view";
import { OWNER_BASIS_LABEL, tierLabel } from "@/lib/provenance/tier-vocab";

import { Button } from "../Button";
import { Icon } from "../Icon";
import { ProvenanceMark } from "../ProvenanceMark";
import { StateBlock } from "../StateBlock";
import { TopBarActions } from "../shell/TopBar";

const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

export function OwnerOverview({ view }: { view: OverviewView }) {
  const e = view.estimate;
  let primaryUsed = false;
  return (
    <div className="mx-auto max-w-[1344px] px-6 py-8 pb-16 lg:px-12" data-overview>
      <TopBarActions>
        {view.costUpdated ? <span className="t-label-md hidden font-bp-mono text-bp-ink-tertiary lg:inline">Cost updated {view.costUpdated}</span> : null}
        {view.viewer ? (
          <Button kind="secondary" href={`/project/${view.projectId}/viewer`}>
            3D view
          </Button>
        ) : null}
      </TopBarActions>

      <p className="t-label-caps text-bp-brass-text">OVERVIEW</p>
      <h1 className="t-display-serif mt-1.5 text-bp-ink-primary">{view.name}</h1>
      {view.meta.length ? <p className="t-label-md mt-1.5 font-bp-mono text-bp-ink-tertiary">{view.meta.join(" · ")}</p> : null}

      <div className="mt-8 grid grid-cols-1 gap-12 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0">
          <section aria-labelledby="estimate-h">
            {e ? (
              <>
                <h2 id="estimate-h" className="t-label-caps text-bp-ink-tertiary">
                  YOUR ESTIMATE · REV {e.rev} · INCL. CONTINGENCY AND VAT
                </h2>
                <p className="mt-2 flex items-center gap-2.5" data-overview-estimate={e.grand}>
                  <span aria-hidden="true" className="t-num-xl text-bp-ink-primary">
                    {e.estimate ? "≈ " : ""}AED {formatAED(e.grand)}
                    {e.excluded.length ? "*" : ""}
                  </span>
                  {e.tier ? <ProvenanceMark tier={e.tier} /> : null}
                  <span className="sr-only">
                    {headlineSpokenText(e.grand, { estimate: e.estimate, excludedLines: e.excluded.length })}
                    {e.tier ? `, ${tierLabel(e.tier, "owner")}` : ""}
                  </span>
                </p>
                <p className="t-body-sm mt-2 max-w-[620px] text-bp-ink-secondary">
                  {e.excluded.length
                    ? `* excludes ${e.excluded.length} item${e.excluded.length === 1 ? "" : "s"} not priced yet: ${list(e.excluded.map((x) => x.description.toLowerCase()))}. `
                    : ""}
                  The mark shows the least certain part of the number.
                </p>
                {e.budget != null ? (
                  <div className="mt-3 pt-3" data-overview-budget={e.budget}>
                    <p className="flex items-baseline">
                      <span className="t-body-sm flex-1 text-bp-ink-primary">Against your budget of AED {e.budget.toLocaleString("en-US")}</span>
                      <span className="t-label-md font-bp-mono text-bp-ink-secondary">{Math.round((e.grand / e.budget) * 100)}%</span>
                    </p>
                    <div className="mt-1.5 h-0.5 w-full bg-bp-line-hairline" aria-hidden="true">
                      <div className="h-0.5 bg-bp-ink-primary" style={{ width: `${Math.min(100, (e.grand / e.budget) * 100)}%` }} />
                    </div>
                  </div>
                ) : null}

                <table className="mt-8 w-full border-collapse" aria-label="What this number is based on" data-testid="overview-basis">
                  <thead>
                    <tr className="bg-bp-surface-sunken">
                      <th scope="col" className="t-label-caps px-3 py-2.5 text-left font-normal text-bp-ink-tertiary">WHAT THIS NUMBER IS BASED ON</th>
                      <th scope="col" className="t-label-caps w-[76px] px-3 py-2.5 text-right font-normal text-bp-ink-tertiary">ITEMS</th>
                      <th scope="col" className="t-label-caps w-[136px] px-3 py-2.5 text-right font-normal text-bp-ink-tertiary">AED</th>
                      <th scope="col" className="t-label-caps w-[80px] px-3 py-2.5 text-right font-normal text-bp-ink-tertiary">SHARE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.basis.map((b) => (
                      <tr key={b.tier} className="border-b border-bp-line-hairline" data-basis-tier={b.tier}>
                        <th scope="row" className={`t-body-sm px-3 py-3 text-left font-normal ${b.tier === "unpriced" ? "text-bp-ink-tertiary" : "text-bp-ink-primary"}`}>
                          <span className="inline-flex items-center gap-2.5">
                            <ProvenanceMark tier={b.tier} />
                            {OWNER_BASIS_LABEL[b.tier]}
                          </span>
                        </th>
                        <td className="t-num-sm px-3 py-3 text-right text-bp-ink-primary">{b.lines}</td>
                        <td className="t-num-sm px-3 py-3 text-right text-bp-ink-primary">{b.amount == null ? "—" : formatAED(b.amount)}</td>
                        <td className="t-num-sm px-3 py-3 text-right text-bp-ink-secondary">{b.share == null ? "—" : `${b.share.toFixed(1)}%`}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-bp-line-strong">
                      <th scope="row" className="t-heading-sm px-3 py-3 text-left text-bp-ink-primary">
                        Counted total
                      </th>
                      <td className="t-num-sm px-3 py-3 text-right text-bp-ink-primary">{e.countedLines}</td>
                      <td className="t-num-sm px-3 py-3 text-right text-bp-ink-primary" data-basis-total={e.counted}>
                        {formatAED(e.counted)}
                      </td>
                      <td className="t-num-sm px-3 py-3 text-right text-bp-ink-secondary">{e.counted ? "100.0%" : "—"}</td>
                    </tr>
                  </tbody>
                </table>
                {/* The headline is the counted total carried through the stored chain — to the fil (H7). */}
                <p className="t-label-md mt-2 font-bp-mono text-bp-ink-tertiary" data-testid="overview-chain">
                  {formatAED(e.counted)} counted + contingency {e.contingencyPct}% {formatAED(e.chain.contingency)} + VAT {e.vatPct}% {formatAED(e.chain.vat)} = {formatAED(e.grand)}
                </p>
              </>
            ) : (
              <StateBlock
                kind="empty"
                icon="request_quote"
                title="No cost yet"
                actions={
                  <Button kind="primary" href={`/project/${view.projectId}/boq`}>
                    Open cost
                  </Button>
                }
              >
                Once your plan is read, we price every room from it — the estimate and what it is based on appear here.
              </StateBlock>
            )}
          </section>

          <section aria-labelledby="design-h" className="mt-10">
            <div className="flex items-center gap-4 border-b-2 border-bp-line-strong pb-2.5">
              <h2 id="design-h" className="t-heading-md flex-1 text-bp-ink-primary">
                Your design
              </h2>
              <p className="t-label-md font-bp-mono text-bp-ink-tertiary">
                {view.design.locked} {view.design.locked === 1 ? "view" : "views"} locked{view.design.direction ? ` · ${view.design.direction}` : ""}
              </p>
            </div>
            {view.design.tiles.length ? (
              <ul className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                {view.design.tiles.map((t) => (
                  <li key={t.url}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a stored render */}
                    <img src={t.url} alt={t.caption} className="h-[140px] w-full border border-bp-line-hairline object-cover" loading="lazy" />
                    <p className="t-body-sm mt-1.5 text-bp-ink-secondary">{t.caption}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="t-body-sm mt-3 text-bp-ink-secondary">
                No view is locked yet.{" "}
                <Link href={`/project/${view.projectId}/render`} className="text-bp-ink-primary underline underline-offset-2">
                  Open renders
                </Link>
              </p>
            )}
          </section>
        </div>

        <aside aria-label="Next and documents" className="min-w-0">
          <h2 className="t-label-caps text-bp-ink-tertiary">NEXT</h2>
          {view.next.length ? (
            <ul>
              {view.next.map((a) => {
                const kind = a.blocked ? "quiet" : primaryUsed ? "secondary" : "primary";
                if (kind === "primary") primaryUsed = true;
                return (
                  <li key={a.step} className="border-b border-bp-line-hairline pb-4 pt-3.5" data-next={a.step}>
                    <p className="t-label-caps flex items-center gap-1.5 text-bp-ink-tertiary">
                      {a.blocked ? <Icon name="lock" className="text-[20px]" /> : null}
                      {a.step}
                    </p>
                    <p className="t-heading-sm mt-1.5 text-bp-ink-primary">{a.title}</p>
                    {a.sentence ? <p className="t-body-sm mt-1.5 text-bp-ink-secondary">{a.sentence}</p> : null}
                    <div className="pt-3">
                      <Button kind={kind} href={a.action.href}>
                        {a.action.label}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="t-body-sm border-b border-bp-line-hairline py-3.5 text-bp-ink-secondary">Nothing is waiting on you.</p>
          )}

          <section aria-labelledby="timeline-h" className="border-b border-bp-line-hairline pb-4 pt-5">
            <h2 id="timeline-h" className="t-label-caps text-bp-ink-tertiary">
              05 · TIMELINE
            </h2>
            {view.timeline.range ? (
              <Link href={`/project/${view.projectId}/timeline`} className="t-num-md mt-1 block text-bp-ink-primary hover:underline">
                {view.timeline.range}
              </Link>
            ) : null}
            <p className="t-body-sm mt-1 text-bp-ink-secondary">{view.timeline.note}</p>
          </section>

          {view.documents.length ? (
            <section aria-labelledby="documents-h" className="pt-5">
              <h2 id="documents-h" className="t-label-caps text-bp-ink-tertiary">
                DOCUMENTS
              </h2>
              <ul>
                {view.documents.map((d) => {
                  const row = (
                    <>
                      <Icon name={d.icon} className={`text-[20px] ${d.locked ? "text-bp-ink-tertiary" : "text-bp-ink-primary"}`} />
                      <span className={`t-body-sm flex-1 ${d.locked ? "text-bp-ink-tertiary" : "text-bp-ink-primary"}`}>{d.label}</span>
                      <span className="t-label-md font-bp-mono text-bp-ink-tertiary">{d.state}</span>
                    </>
                  );
                  return (
                    <li key={d.key} className="border-b border-bp-line-hairline" data-document={d.key}>
                      {d.href ? (
                        <Link href={d.href} className="flex min-h-11 items-center gap-2.5 py-2 hover:bg-bp-surface-raised">
                          {row}
                        </Link>
                      ) : (
                        <span className="flex min-h-11 items-center gap-2.5 py-2">{row}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

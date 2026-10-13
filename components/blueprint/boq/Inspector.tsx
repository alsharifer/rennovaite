"use client";

// =============================================================================
// components/blueprint/boq/Inspector.tsx — the line inspector (R7 §3.2;
// 13:48 right, 16:1580 What-if, 16:1654 capture correction).
//
// <aside aria-labelledby> on desktop (§4.2 #4): opening it moves focus to its
// heading; Close (or Escape) returns focus to the row. On touch widths the SAME
// content renders in a modal bottom sheet (BoqReview owns which). Tabs are
// WAI-ARIA tabs — ←→ between them, aria-selected, underline + weight (§4.2 #8).
//
// Line tab: the arithmetic with each input's mark, the weaker-input sentence,
// the QUANTITY and RATE blocks from the curated provenance, and — for a firm —
// whether its own book has an entry ("Add to my book" opens the book's add
// form PREFILLED; nothing is saved until the member saves it there).
//
// K11 #4 (spec §7.3, 80:9042 · 80:9088): an unpriced line offers "Add a
// price", and "Capture correction" opens the capture form IN the Line tab
// (./CorrectionsTab CaptureForm); applying either creates the next revision.
// =============================================================================

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";

import { formatAED, formatQty } from "@/lib/format/aed";
import type { ReviewLine, ReviewModel } from "@/lib/boq/review-types";
import { tierLabel } from "@/lib/provenance/tier-vocab";
import type { FigureProvenance } from "@/lib/provenance/types";

import { Button } from "../Button";
import { Icon } from "../Icon";
import { ProvenanceMark } from "../ProvenanceMark";
import { TierLabel } from "../TierLabel";
import { CaptureForm, CorrectionsList, type Applied, type Correction } from "./CorrectionsTab";
import { displayUnit } from "./format";
import { weakerSentence } from "./ProvenancePopover";
import { WhatIfTab, type WhatIfEngine } from "./WhatIfTab";

export type InspectorTab = "line" | "whatif" | "corrections";

export interface InspectorProps {
  line: ReviewLine;
  model: ReviewModel;
  tab: InspectorTab;
  setTab: (t: InspectorTab) => void;
  corrections: Correction[];
  capturing: boolean;
  setCapturing: (v: boolean) => void;
  onCorrectionSaved: (c: Correction) => void;
  /** K11 #4: a price / correction applied — the next revision exists. */
  onApplied: (a: Applied) => void;
  engine: WhatIfEngine | null;
  furniture: number | null;
  onClose: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}

const TABS: InspectorTab[] = ["line", "whatif", "corrections"];

function Block({ children, first }: { children: ReactNode; first?: boolean }) {
  return <div className={first ? "" : "mt-5 border-t border-bp-line-hairline pt-5"}>{children}</div>;
}

function steps(p: FigureProvenance | undefined, kinds: string[]) {
  return (p?.steps ?? []).filter((s) => kinds.includes(s.kind));
}

/** The take-off's formula, without its trailing provenance prose. */
function formula(detail: string): string {
  const cut = detail.search(/\s(\(|—)\s?/);
  return cut > 0 ? detail.slice(0, cut) : detail;
}

export function Inspector({ headingRef, ...p }: InspectorProps) {
  const { line, model } = p;
  const base = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const lineCorrections = p.corrections;

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    // On open and when the line changes, focus the heading (§4.2 #4).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.key]);

  function onTabKey(e: KeyboardEvent, i: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const n = e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    p.setTab(TABS[n]!);
    tabRefs.current[n]?.focus();
  }

  const label = (t: InspectorTab) => (t === "line" ? "Line" : t === "whatif" ? "What-if" : `Corrections · ${lineCorrections.length}`);
  const unit = displayUnit(line.unit);
  const q = line.prov?.quantity;
  const r = line.prov?.rate;
  const takeoff = steps(q, ["rule"]).find((s) => s.label === "Take-off");
  const geometry = steps(q, ["geometry"]);
  // One line per distinct note (seven elements of one reference layout share it).
  const qFlags = steps(q, ["flag"]).filter((f, i, all) => all.findIndex((x) => x.detail === f.detail) === i);
  const source = steps(r, ["source"])[0];
  const basis = steps(r, ["rule"]).find((s) => s.label === "Rate basis");
  const tierStep = steps(r, ["tier"])[0];
  const qs = steps(r, ["qs"])[0];
  const book = line.book;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-end justify-between border-b border-bp-line-hairline px-4">
        <div role="tablist" aria-label="Inspector" className="flex gap-5">
          {TABS.map((t, i) => (
            <button
              key={t}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${t}`}
              aria-selected={p.tab === t}
              aria-controls={`${base}-panel-${t}`}
              tabIndex={p.tab === t ? 0 : -1}
              onKeyDown={(e) => onTabKey(e, i)}
              onClick={() => p.setTab(t)}
              className={`-mb-px border-b-2 py-3 ${p.tab === t ? "t-nav-item-active border-bp-brass text-bp-ink-primary" : "t-nav-item border-transparent text-bp-ink-secondary hover:text-bp-ink-primary"}`}
            >
              {label(t)}
            </button>
          ))}
        </div>
        <button type="button" onClick={p.onClose} className="mb-2 flex size-9 items-center justify-center text-bp-ink-secondary hover:text-bp-ink-primary" aria-label="Close the inspector">
          <Icon name="close" size={20} />
        </button>
      </div>

      <div role="tabpanel" id={`${base}-panel-${p.tab}`} aria-labelledby={`${base}-tab-${p.tab}`} className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4">
        <p className="t-label-caps text-bp-ink-tertiary">
          {line.ref} · {line.section.toUpperCase()}
        </p>
        <h2 ref={headingRef} id="bp-boq-inspector-heading" tabIndex={-1} className="t-heading-md mt-2 text-bp-ink-primary outline-none" data-inspector-heading="">
          {line.description}
        </h2>

        {p.tab === "line" && p.capturing ? (
          <div className="mt-5">
            <CaptureForm
              line={line}
              model={model}
              onCancel={() => p.setCapturing(false)}
              onSaved={(c) => {
                p.onCorrectionSaved(c);
                p.setCapturing(false);
                p.setTab("corrections");
              }}
              onApplied={(a) => {
                p.setCapturing(false);
                p.onApplied(a);
              }}
            />
          </div>
        ) : p.tab === "line" ? (
          <>
            <Block>
              <p className="flex items-center gap-2">
                <span className={line.unpriced ? "t-label-md text-bp-ink-tertiary" : "t-num-lg"}>{line.unpriced ? "to be priced" : formatAED(line.amount)}</span>
                <TierLabel tier={line.tiers.amount} persona={model.persona} />
              </p>
              {line.unpriced ? (
                <>
                  <p className="t-body-sm mt-2 text-bp-ink-secondary">Not in any total — {line.unpricedReason}.</p>
                  <div className="mt-3">
                    <Button kind="primary" onClick={() => p.setCapturing(true)} testId="add-a-price">
                      Add a price
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="t-num-sm mt-2 flex flex-wrap items-center gap-1.5">
                    {formatQty(line.quantity)} {unit} <ProvenanceMark tier={line.tiers.qty} /> <span className="text-bp-ink-tertiary">×</span> {formatAED(line.rate)} <ProvenanceMark tier={line.tiers.rate} /> <span className="text-bp-ink-tertiary">=</span> {formatAED(line.amount)}
                  </p>
                  <p className="t-body-sm mt-2 text-bp-ink-secondary">{weakerSentence(line, model.persona)}</p>
                </>
              )}
            </Block>

            <Block>
              <p className="flex items-center gap-2">
                <span className="t-label-caps text-bp-ink-tertiary">QUANTITY</span>
                <TierLabel tier={line.tiers.qty} why={line.tiers.qtyWhy} persona={model.persona} role="qty" />
              </p>
              {takeoff ? <p className="t-num-sm mt-2">{formula(takeoff.detail)}</p> : <p className="t-num-sm mt-2">{formatQty(line.quantity)} {unit}</p>}
              {geometry.map((g, i) => (
                <p key={`g${i}`} className="t-body-sm mt-2 text-bp-ink-secondary">
                  {g.label} · {g.detail}
                </p>
              ))}
              {qFlags.map((f, i) => (
                <p key={`f${i}`} className="t-body-sm mt-1 text-bp-ink-secondary">
                  {f.detail}
                </p>
              ))}
              {line.derivedNote ? <p className="t-body-sm mt-1 text-bp-ink-secondary">{line.derivedNote}</p> : null}
              {line.elementRefs.length > 0 ? (
                <div className="mt-3">
                  <Button kind="quiet" href={`/project/${model.projectId}/plan`}>
                    Show on plan
                  </Button>
                </div>
              ) : null}
            </Block>

            <Block>
              <p className="flex items-center gap-2">
                <span className="t-label-caps text-bp-ink-tertiary">RATE</span>
                <TierLabel tier={line.tiers.rate} why={line.tiers.rateWhy} persona={model.persona} role="rate" />
              </p>
              <p className="t-num-sm mt-2">{line.unpriced ? `— / ${unit} · no rate in any book` : `${formatAED(line.rate)} / ${unit}`}</p>
              {source ? <p className="t-body-sm mt-2 text-bp-ink-secondary">{source.detail}</p> : null}
              {basis ? <p className="t-body-sm mt-1 text-bp-ink-secondary">{basis.detail}</p> : null}
              {tierStep ? <p className="t-body-sm mt-1 text-bp-ink-secondary">{tierStep.detail}</p> : null}
              {qs ? <p className="t-label-md mt-1 text-bp-ink-tertiary">{qs.detail}</p> : null}
              {book && model.firm ? (
                book.hasEntry ? (
                  <p className="t-body-sm mt-3 text-bp-ink-secondary">{line.tiers.rate === "measured" ? "Priced from your book." : "Your book has an entry for this item — regenerate to price this line from it."}</p>
                ) : (
                  <>
                    <p className="t-body-sm mt-3 text-bp-ink-secondary">
                      Your book has no entry for this item, so {line.unpriced ? "it stays to be priced" : `the ${tierLabel(line.tiers.rate, "firm", "rate").toLowerCase()} applies`}.
                    </p>
                    {book.canAdd && line.itemKey ? (
                      <div className="mt-3">
                        <Button kind="quiet" href={`/project/${model.projectId}/rates?add=${encodeURIComponent(line.itemKey)}${line.unpriced ? "" : `&rate=${line.rate}`}#new-entry`}>
                          Add to my book
                        </Button>
                      </div>
                    ) : null}
                  </>
                )
              ) : null}
            </Block>

            <Block>
              <div className="flex flex-wrap items-center gap-6">
                <Button kind="secondary" onClick={() => p.setCapturing(true)}>
                  Capture correction
                </Button>
                <Button kind="quiet" href={`/project/${model.projectId}/boq/revisions`}>
                  Line history
                </Button>
              </div>
            </Block>
          </>
        ) : p.tab === "whatif" ? (
          <div className="mt-5">
            <WhatIfTab projectId={model.projectId} rev={model.rev} total={model.headline.total} estimate={model.headline.estimate} engine={p.engine} furniture={p.furniture} />
          </div>
        ) : (
          <div className="mt-5">
            <CorrectionsList
              line={line}
              model={model}
              corrections={lineCorrections}
              onCapture={() => {
                p.setCapturing(true);
                p.setTab("line");
              }}
              onApplied={p.onApplied}
            />
          </div>
        )}
      </div>
    </div>
  );
}

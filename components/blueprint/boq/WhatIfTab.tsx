"use client";

// =============================================================================
// components/blueprint/boq/WhatIfTab.tsx — the inspector's What-if tab
// (R7 §3.2, 16:1580). A SCENARIO, NEVER THE BOQ: nothing here changes the
// stored revision or the pinned total.
//
// It wraps the two existing engines, unchanged:
//   • the P5 grade picker (lib/whatif/engine.ts recalc) when the BoQ has
//     take-off provenance and WHATIF is on — its scenario runs the shared
//     chain, so the scenario chain rows are real (OH&P, contingency and VAT
//     move with the lines);
//   • otherwise the cost-sensitivity modifiers. Their engine is an
//     illustrative ±% of the PROJECT TOTAL (not of the counted subtotal, and
//     no chain is recomputed) — so, per K0.4, the copy says exactly that and
//     there are no chain rows: the copy follows the engine.
// Modifiers are native checkboxes, grades a radio group with a legend
// (§4.2 #9); the scenario total is a polite live region (§4.2 #7).
// =============================================================================

import { useId, useMemo, useState } from "react";

import { formatAED, formatDelta } from "@/lib/format/aed";
import { WHATIF_BEFORE_MARKUPS, WHATIF_INCL_MARKUPS, recalc, suggestForBudget, type RateBook, type ScenarioBoq, type Selections } from "@/lib/whatif/engine";
import type { Grade, GradeableItem } from "@/lib/whatif/grades";

import { Button } from "../Button";

/** The four illustrative modifiers (K0.4: % of the project total; backlog: they carry no provenance). */
const SENSITIVITY = [
  { id: "premium", label: "Premium materials", pct: 15 },
  { id: "local-labour", label: "Local labour sourcing", pct: -8 },
  { id: "tight", label: "Tight schedule (60 days)", pct: 6 },
  { id: "phased", label: "Phase the work (2 phases)", pct: -3 },
] as const;

const GRADES: Grade[] = ["economy", "standard", "premium"];

export interface WhatIfEngine {
  rateBook: RateBook;
  boq: ScenarioBoq;
  initialSelections: Selections;
}

const pct = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}%`;

function Line({ label, value, strong, live }: { label: string; value: string; strong?: boolean; live?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 ${strong ? "border-t border-bp-line-strong pt-2.5" : ""}`}>
      <span className={strong ? "t-heading-sm" : "t-body-sm text-bp-ink-secondary"}>{label}</span>
      <span className={strong ? "t-num-lg" : "t-num-md"} {...(live ? { "aria-live": "polite" as const } : {})}>
        {value}
      </span>
    </div>
  );
}

export function WhatIfTab({ projectId, rev, total, estimate, engine, furniture }: { projectId: string; rev: number; total: number; estimate: boolean; engine: WhatIfEngine | null; furniture: number | null }) {
  const [on, setOn] = useState<Set<string>>(() => new Set());
  const [withFurniture, setWithFurniture] = useState(false);
  const [selections, setSelections] = useState<Selections>(engine?.initialSelections ?? {});
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [target, setTarget] = useState(Math.round(total));
  const furnId = useId();
  const approx = estimate ? "≈ " : "";

  const scenario = useMemo(() => (engine ? recalc(engine.boq, engine.rateBook, selections) : null), [engine, selections]);
  const sensPct = SENSITIVITY.filter((s) => on.has(s.id)).reduce((n, s) => n + s.pct, 0);
  const furnitureAed = withFurniture && furniture ? furniture : 0;
  const scenarioTotal = engine && scenario ? scenario.total + furnitureAed : Math.round(total * (1 + sensPct / 100) * 100) / 100 + furnitureAed;
  const diff = Math.round((scenarioTotal - total) * 100) / 100;
  const diffPct = total ? Math.round((diff / total) * 1000) / 10 : 0;
  const changed = engine ? Object.keys(selections).length > 0 || withFurniture : on.size > 0 || withFurniture;

  async function save() {
    if (!scenario) return;
    setSaved("saving");
    try {
      const res = await fetch("/api/whatif-scenario", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project_id: projectId, selections, total: scenario.total }) });
      setSaved(res.ok ? "saved" : "error");
    } catch {
      setSaved("error");
    }
  }
  function reset() {
    setOn(new Set());
    setSelections({});
    setWithFurniture(false);
    setSaved("idle");
  }

  return (
    <div data-whatif={engine ? "grades" : "sensitivity"}>
      <p className="t-label-caps text-bp-ink-tertiary">{engine ? "GRADE SCENARIO" : "COST SENSITIVITY"} · A SCENARIO, NEVER THE BOQ</p>

      <div className="mt-3">
        <Line label={`Baseline · rev ${rev}`} value={`${approx}${formatAED(total)}`} />
        <Line label="This scenario" value={`${approx}${formatAED(scenarioTotal)}`} strong live />
        <Line label="Difference" value={diff === 0 ? "—" : `${formatDelta(diff)} (${formatDelta(diffPct, "pct")})`} />
      </div>

      {engine && scenario ? (
        <>
          <p className="t-label-md mt-4 text-bp-ink-tertiary">Grade changes are line changes, {WHATIF_BEFORE_MARKUPS}; the scenario total is {WHATIF_INCL_MARKUPS}.</p>
          <div className="mt-2 divide-y divide-bp-line-hairline border-y border-bp-line-hairline">
            {scenario.perChange.map((c) => (
              <fieldset key={c.item_key} className="py-3">
                <legend className="t-body-sm flex w-full items-baseline justify-between text-bp-ink-primary">
                  <span>
                    {c.label}
                    {!selections[c.item_key] ? <span className="t-label-md ml-2 text-bp-ink-tertiary">as priced</span> : null}
                  </span>
                  <span className="t-label-md text-bp-ink-tertiary">
                    {Math.round(c.quantity)} {c.unit}
                  </span>
                </legend>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {GRADES.map((g) => {
                    const entry = engine.rateBook[c.item_key as GradeableItem][g];
                    const d = Math.round((entry.rate_aed - c.baseline_rate) * c.quantity * 100) / 100;
                    // Unchosen = the line stays at the rate it was PRICED at (H4) — no grade is ticked.
                    const checked = selections[c.item_key] === g;
                    return (
                      <label key={g} className={`flex cursor-pointer flex-col items-start border px-2 py-1.5 ${checked ? "border-bp-line-strong border-b-2 border-b-bp-brass" : "border-bp-line-control"}`} title={entry.spec}>
                        <span className="flex items-center gap-1.5">
                          <input type="radio" name={`grade-${c.item_key}`} value={g} checked={checked} onChange={() => setSelections((s) => ({ ...s, [c.item_key]: g }))} className="accent-bp-ink-primary" />
                          <span className="t-label-md capitalize text-bp-ink-primary">{g}</span>
                        </span>
                        <span className="t-num-sm text-bp-ink-secondary">{d === 0 ? "—" : formatDelta(d)}</span>
                        {!entry.qs_validated ? <span className="t-label-md text-bp-ink-tertiary">indicative</span> : null}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
          {scenario.chain ? (
            <div className="mt-4">
              <p className="t-label-caps text-bp-ink-tertiary">SCENARIO CHAIN</p>
              <Line label="Scenario subtotal" value={formatAED(scenario.chain.subtotal_aed)} />
              {scenario.chain.ohp_aed > 0 ? <Line label={`OH&P ${scenario.chain.ohp_pct}%`} value={formatAED(scenario.chain.ohp_aed)} /> : null}
              <Line label={`Contingency ${scenario.chain.contingency_pct}%`} value={formatAED(scenario.chain.contingency_aed)} />
              <Line label={`VAT ${scenario.chain.vat_pct}%`} value={formatAED(scenario.chain.vat_aed)} />
              <Line label="Scenario total" value={`${approx}${formatAED(scenario.chain.grand_total_aed)}`} strong />
            </div>
          ) : null}
          <div className="mt-4">
            <label className="t-label-caps flex items-baseline justify-between text-bp-ink-tertiary">
              TARGET TOTAL <span className="t-num-sm text-bp-ink-primary">{formatAED(target)}</span>
            </label>
            <input
              type="range"
              min={Math.round(total * 0.6)}
              max={Math.round(total * 1.05)}
              step={1000}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
              onPointerUp={() => setSelections(suggestForBudget(engine.boq, engine.rateBook, target))}
              onKeyUp={() => setSelections(suggestForBudget(engine.boq, engine.rateBook, target))}
              aria-label="Target total — suggests grades to meet it"
              className="mt-1 w-full accent-bp-ink-primary"
            />
            <p className="t-label-md text-bp-ink-tertiary">Suggests economy grades on the largest savings first — a starting point, not a design decision.</p>
          </div>
        </>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-bp-line-hairline border-y border-bp-line-hairline">
            {SENSITIVITY.map((s) => {
              const checked = on.has(s.id);
              return (
                <li key={s.id}>
                  <label className="flex cursor-pointer items-center gap-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setOn((cur) => {
                          const next = new Set(cur);
                          if (next.has(s.id)) next.delete(s.id);
                          else next.add(s.id);
                          return next;
                        })
                      }
                      className="size-4 accent-bp-ink-primary"
                    />
                    <span className="t-body-sm flex-1 text-bp-ink-primary">{s.label}</span>
                    <span className="t-label-md w-10 text-right text-bp-ink-secondary">{pct(s.pct)}</span>
                    <span className="t-num-sm w-24 text-right text-bp-ink-primary">{checked ? formatDelta(Math.round(total * s.pct) / 100) : "—"}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="t-body-sm mt-4 text-bp-ink-secondary">
            Each modifier is an illustrative ±% of the project total — never the BoQ. Contingency and VAT are not recomputed and the lines to be priced stay out. To change the BoQ itself, change rates or scope and regenerate.
          </p>
        </>
      )}

      {furniture ? (
        <label htmlFor={furnId} className="mt-4 flex cursor-pointer items-center gap-3 border-t border-bp-line-hairline pt-3">
          <input id={furnId} type="checkbox" checked={withFurniture} onChange={() => setWithFurniture((v) => !v)} className="size-4 accent-bp-ink-primary" />
          <span className="t-body-sm flex-1 text-bp-ink-primary">Include optional furniture</span>
          <span className="t-num-sm text-bp-ink-primary">{withFurniture ? formatDelta(furniture) : "—"}</span>
        </label>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-6 border-t border-bp-line-hairline pt-4">
        {engine ? (
          <Button kind="secondary" onClick={saved === "saving" ? undefined : save}>
            {saved === "saving" ? "Saving…" : "Save scenario"}
          </Button>
        ) : null}
        <Button kind="quiet" onClick={reset} disabled={changed ? false : { reason: "Nothing to reset", reasonId: `${furnId}-reset` }}>
          Reset
        </Button>
        <span className="t-label-md text-bp-ink-tertiary" aria-live="polite">
          {saved === "saved" ? "Scenario saved — it never changes the BoQ." : saved === "error" ? "The scenario was not saved." : !engine ? "Sensitivity scenarios are illustrative and not stored." : ""}
        </span>
        {!changed ? (
          <span id={`${furnId}-reset`} className="sr-only">
            Nothing to reset
          </span>
        ) : null}
      </div>
    </div>
  );
}

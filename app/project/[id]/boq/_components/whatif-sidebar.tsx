"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import type { Grade, GradeableItem } from "@/lib/whatif/grades";

export interface WhatIfOption {
  grade: Grade;
  rate: number;
  delta: number; // vs baseline, AED (signed)
  qs_validated: boolean;
  spec: string;
}
export interface WhatIfRow {
  item_key: GradeableItem;
  label: string;
  qty: number;
  options: WhatIfOption[];
  selected: Grade;
}

const GRADES: Grade[] = ["economy", "standard", "premium"];

function fmtDelta(n: number): string {
  if (Math.round(n) === 0) return "—";
  const abs = Math.abs(Math.round(n)).toLocaleString("en-US");
  return n > 0 ? `+${abs}` : `−${abs}`;
}
function fmtAed(n: number): string {
  return `AED ${Math.round(n).toLocaleString("en-US")}`;
}

export function WhatIfSidebar({
  rows,
  baselineTotal,
  scenarioTotal,
  changed,
  onSelect,
  onReset,
  onBudget,
  onClose,
}: {
  rows: WhatIfRow[];
  baselineTotal: number;
  scenarioTotal: number;
  changed: boolean;
  onSelect: (item: GradeableItem, grade: Grade) => void;
  onReset: () => void;
  onBudget: (target: number) => void;
  onClose: () => void;
}) {
  const delta = scenarioTotal - baselineTotal;
  const [target, setTarget] = useState<number>(Math.round(baselineTotal));

  return (
    <aside className="flex flex-col gap-md rounded-xl border border-ink-100 bg-paper p-lg">
      <div className="flex items-center justify-between">
        <p className="label-caps text-brass-600">What if</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Collapse what-if panel"
          className="focus-ring flex size-7 items-center justify-center rounded text-on-surface-variant hover:text-ink-900"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>
      <p className="font-body-sm text-body-sm text-on-surface-variant">
        Change a material grade and watch the total move. Priced from the
        QS-validated rate book — never mutates your baseline BoQ.
      </p>

      {/* Delta vs baseline */}
      <div className="rounded-md border border-ink-100 bg-canvas p-md">
        <div className="flex items-baseline justify-between">
          <span className="label-caps text-ink-500">vs QS baseline</span>
          <span
            className={cn(
              "font-mono text-body-md tabular-nums",
              delta > 0 ? "text-error" : delta < 0 ? "text-tertiary" : "text-ink-500",
            )}
          >
            {delta === 0 ? "±0" : fmtDelta(delta)}
          </span>
        </div>
        <p className="mt-xs font-mono text-[11px] text-ink-500">
          {fmtAed(baselineTotal)} → {fmtAed(scenarioTotal)}
        </p>
      </div>

      {/* Grade toggle rows */}
      <div className="flex flex-col gap-md">
        {rows.map((row) => (
          <div key={row.item_key} className="flex flex-col gap-xs">
            <div className="flex items-baseline justify-between">
              <span className="font-body-sm text-body-sm font-semibold text-ink-900">
                {row.label}
              </span>
              <span className="font-mono text-[11px] text-ink-500">
                {Math.round(row.qty)} m²
              </span>
            </div>
            <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-ink-100">
              {GRADES.map((g) => {
                const opt = row.options.find((o) => o.grade === g)!;
                const active = row.selected === g;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => onSelect(row.item_key, g)}
                    aria-pressed={active}
                    title={opt.spec}
                    className={cn(
                      "flex flex-col items-center gap-0.5 px-1 py-1.5 transition-colors",
                      active
                        ? "bg-brass-600 text-on-primary"
                        : "bg-paper text-ink-700 hover:bg-surface-container",
                    )}
                  >
                    <span className="flex items-center gap-1 text-[11px] font-semibold capitalize">
                      {!opt.qs_validated && (
                        <span
                          className="inline-block size-1.5 rounded-full bg-tertiary"
                          title="Indicative — pending QS validation"
                        />
                      )}
                      {g}
                    </span>
                    <span className="font-mono text-[10px] tabular-nums">
                      {fmtDelta(opt.delta)}
                    </span>
                  </button>
                );
              })}
            </div>
            {(() => {
              const sel = row.options.find((o) => o.grade === row.selected)!;
              return !sel.qs_validated ? (
                <span className="font-body-sm text-[11px] text-tertiary">
                  Indicative — pending QS validation
                </span>
              ) : null;
            })()}
          </div>
        ))}
      </div>

      {/* Budget dial */}
      <div className="mt-sm border-t border-bone pt-md">
        <div className="flex items-baseline justify-between">
          <span className="label-caps text-ink-500">Budget dial</span>
          <span className="font-mono text-body-sm tabular-nums text-ink-900">{fmtAed(target)}</span>
        </div>
        <input
          type="range"
          min={Math.round(baselineTotal * 0.6)}
          max={Math.round(baselineTotal * 1.05)}
          step={1000}
          value={target}
          onChange={(e) => setTarget(Number(e.target.value))}
          onMouseUp={() => onBudget(target)}
          onTouchEnd={() => onBudget(target)}
          className="mt-xs w-full accent-brass-600"
          aria-label="Target total"
        />
        <p className="mt-xs font-body-sm text-[11px] italic text-on-surface-variant">
          A starting point — not a design decision.
        </p>
      </div>

      {changed && (
        <button
          type="button"
          onClick={onReset}
          className="focus-ring self-start font-body-sm text-body-sm font-semibold text-brass-600 hover:underline"
        >
          Reset to QS baseline
        </button>
      )}
    </aside>
  );
}

"use client";

// =============================================================================
// components/blueprint/boq/SectionIndex.tsx — the sticky section index (184 px)
// and, on tablet / phone, the section chips that replace it (R7 §3.2,
// 13:48 left · 14:890 / 26:924 chips · 17:1602 compact).
//
// <nav aria-label="BoQ sections">: ONE tab stop (roving), ↑↓ between sections,
// Enter jumps — it scrolls to the section and moves focus to its header
// (§4.2 #5). The current section carries the brass rule. More than 10
// sections → compact items: one line, the name truncated with the full name
// in `title` and in the accessible name (§4.2 #14), whole-dirham subtotal.
// =============================================================================

import { useRef, useState, type KeyboardEvent } from "react";

import { formatAED } from "@/lib/format/aed";
import type { ReviewSection } from "@/lib/boq/review-types";
import type { Persona } from "@/lib/provenance/tier-vocab";
import { tierLabel } from "@/lib/provenance/tier-vocab";

import { ProvenanceMark } from "../ProvenanceMark";
import { wholeAed } from "./format";

const COMPACT_OVER = 10;

function useRoving(count: number, current: number) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focus, setFocus] = useState<number | null>(null);
  const at = focus ?? Math.max(0, current);
  function onKeyDown(e: KeyboardEvent, i: number, prev: string, next: string) {
    if (e.key !== prev && e.key !== next && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const n = e.key === "Home" ? 0 : e.key === "End" ? count - 1 : e.key === next ? Math.min(i + 1, count - 1) : Math.max(i - 1, 0);
    setFocus(n);
    refs.current[n]?.focus();
  }
  return { refs, at, setFocus, onKeyDown };
}

export function SectionIndex({
  sections,
  current,
  onJump,
  onSummary,
  allCollapsed,
  onToggleAll,
  persona,
  extra,
}: {
  sections: ReviewSection[];
  current: string | null;
  onJump: (name: string) => void;
  onSummary: () => void;
  allCollapsed: boolean;
  onToggleAll: () => void;
  persona: Persona;
  extra?: React.ReactNode;
}) {
  const compact = sections.length > COMPACT_OVER;
  const cur = sections.findIndex((s) => s.name === current);
  const rv = useRoving(sections.length, cur);
  return (
    <nav aria-label="BoQ sections" className="bp-boq-index">
      <p className="t-label-caps mb-3 px-3 text-bp-ink-tertiary">SECTIONS · {sections.length}</p>
      <ul>
        {sections.map((s, i) => {
          const active = s.name === current;
          const amount = s.tier === "unpriced" ? "to be priced" : compact ? wholeAed(s.subtotal) : formatAED(s.subtotal);
          const said = `${s.code} ${s.name}, ${s.tier === "unpriced" ? "to be priced" : `AED ${formatAED(s.subtotal)}`}${s.tier ? `, ${tierLabel(s.tier, persona).toLowerCase()}` : ""}${s.tbp > 0 ? `, ${s.tbp} to be priced` : ""}`;
          return (
            <li key={s.name}>
              <button
                ref={(el) => {
                  rv.refs.current[i] = el;
                }}
                type="button"
                tabIndex={i === rv.at ? 0 : -1}
                onFocus={() => rv.setFocus(i)}
                onKeyDown={(e) => rv.onKeyDown(e, i, "ArrowUp", "ArrowDown")}
                onClick={() => onJump(s.name)}
                aria-current={active ? "location" : undefined}
                aria-label={said}
                title={compact ? s.name : undefined}
                className={`relative w-full px-3 text-left hover:bg-bp-surface-raised ${compact ? "py-1.5" : "py-2"} ${
                  active ? "bg-bp-surface-raised before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-bp-brass before:content-['']" : ""
                }`}
              >
                {compact ? (
                  <span className="flex items-baseline gap-3">
                    <span className={`t-label-md w-8 shrink-0 ${active ? "text-bp-brass-text" : "text-bp-ink-tertiary"}`}>{s.code}</span>
                    <span className="t-body-sm min-w-0 flex-1 truncate text-bp-ink-primary">{s.name}</span>
                    <span className="t-num-sm shrink-0 text-bp-ink-secondary">{amount}</span>
                  </span>
                ) : (
                  <>
                    <span className="flex items-baseline gap-3">
                      <span className={`t-label-md w-8 shrink-0 ${active ? "text-bp-brass-text" : "text-bp-ink-tertiary"}`}>{s.code}</span>
                      <span className={`t-body-sm min-w-0 flex-1 text-bp-ink-primary ${active ? "font-semibold" : ""}`}>{s.name}</span>
                    </span>
                    <span className="mt-0.5 flex items-center justify-end gap-1.5">
                      {s.tbp > 0 && s.tier !== "unpriced" ? <span className="t-label-md text-bp-ink-tertiary">{s.tbp} TBP</span> : null}
                      <span className={s.tier === "unpriced" ? "t-label-md text-bp-ink-tertiary" : "t-num-sm text-bp-ink-secondary"}>{s.tbp > 0 && s.tier === "unpriced" ? `${s.tbp} TBP to be priced` : amount}</span>
                      {s.tier ? <ProvenanceMark tier={s.tier} /> : null}
                    </span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 space-y-1 border-t border-bp-line-hairline px-3 pt-4">
        <button type="button" onClick={onSummary} className="t-nav-item-active block py-1.5 text-left text-bp-ink-primary hover:text-bp-ink-secondary">
          Summary &amp; totals
        </button>
        <button type="button" onClick={onToggleAll} className="t-nav-item-active block py-1.5 text-left text-bp-ink-primary hover:text-bp-ink-secondary">
          {allCollapsed ? "Expand all" : "Collapse all"}
        </button>
        {extra}
      </div>
    </nav>
  );
}

/** Tablet / phone: the chip strip (prefix + weakest mark; active = brass underline). */
export function SectionChips({ sections, current, onJump, persona }: { sections: ReviewSection[]; current: string | null; onJump: (name: string) => void; persona: Persona }) {
  const cur = sections.findIndex((s) => s.name === current);
  const rv = useRoving(sections.length, cur);
  return (
    <nav aria-label="BoQ sections" className="bp-boq-chips gap-2 overflow-x-auto border-b border-bp-line-hairline bg-bp-surface-base px-6 py-2.5">
      {sections.map((s, i) => {
        const active = s.name === current;
        return (
          <button
            key={s.name}
            ref={(el) => {
              rv.refs.current[i] = el;
            }}
            type="button"
            tabIndex={i === rv.at ? 0 : -1}
            onFocus={() => rv.setFocus(i)}
            onKeyDown={(e) => rv.onKeyDown(e, i, "ArrowLeft", "ArrowRight")}
            onClick={() => onJump(s.name)}
            aria-current={active ? "location" : undefined}
            aria-label={`${s.name}${s.tier ? `, ${tierLabel(s.tier, persona).toLowerCase()}` : ""}`}
            className={`relative inline-flex h-8 shrink-0 items-center gap-1.5 border px-2.5 t-label-md pointer-coarse:before:absolute pointer-coarse:before:-inset-y-2 pointer-coarse:before:inset-x-0 pointer-coarse:before:content-[''] ${
              active ? "border-bp-line-strong border-b-2 border-b-bp-brass text-bp-ink-primary" : "border-bp-line-control text-bp-ink-secondary"
            }`}
          >
            {s.code}
            {s.tier ? <ProvenanceMark tier={s.tier} /> : null}
          </button>
        );
      })}
    </nav>
  );
}

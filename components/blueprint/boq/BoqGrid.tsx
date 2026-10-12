"use client";

// =============================================================================
// components/blueprint/boq/BoqGrid.tsx — the BoQ table as an ARIA grid
// (R7 §2 BoQ row 12:314 + section header 12:335, §4.2 #3/#5, §4.3).
//
// ONE tab stop (roving tabindex): Tab enters and leaves the grid; arrows move
// between cells (hidden columns are skipped, so tablet / phone layouts work
// the same); Enter on a line opens the inspector; Space / Enter on a section
// header toggles it (it is a <button aria-expanded aria-controls>); Escape
// closes the provenance popover. Focusing a figure cell opens its popover —
// keyboard users get the same provenance as hover users (§4.2 #2).
//
// Rows follow §2: one text line (the title wraps to two at most, then the
// inspector has the rest), each figure with its mark (R1: the amount takes the
// weaker of quantity and rate). Sources never appear in a row — they live in
// the popover and the inspector.
// =============================================================================

import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import type { ReviewLine, ReviewSection } from "@/lib/boq/review-types";
import { formatAED, formatQty } from "@/lib/format/aed";
import { describeFigure, type FigureRole, type Persona } from "@/lib/provenance/tier-vocab";

import { Figure } from "../Figure";
import { Icon } from "../Icon";
import { ProvenanceMark } from "../ProvenanceMark";
import { POPOVER_ID } from "./ProvenancePopover";
import { displayUnit, linesWord } from "./format";

export interface FigureHandlers {
  /** Pointer hovered a figure cell (the caller applies the 250 ms delay). */
  onFigureEnter: (line: ReviewLine, role: FigureRole, el: HTMLElement) => void;
  onFigureLeave: () => void;
  /** Keyboard focus reached a figure cell — the popover follows it at once. */
  onFigureFocus: (line: ReviewLine, role: FigureRole, el: HTMLElement) => void;
  onFigureBlur: () => void;
  onEscape: () => boolean;
  /** "REF:role" the popover is showing, for aria-describedby. */
  popoverFor: string | null;
}

interface Props extends FigureHandlers {
  sections: ReviewSection[];
  collapsed: ReadonlySet<string>;
  onToggleSection: (name: string) => void;
  selectedKey: string | null;
  onOpenLine: (key: string, from: HTMLElement | null) => void;
  persona: Persona;
}

type NavRow = { kind: "head"; section: ReviewSection } | { kind: "line"; line: ReviewLine };

export const sectionDomId = (code: string) => `boq-sec-${code}`;
export const linesDomId = (code: string) => `boq-sec-${code}-lines`;
export const rowDomId = (ref: string) => `boq-row-${ref}`;

const LINE_COLS = 7;

export function BoqGrid(p: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const rows: NavRow[] = [];
  for (const s of p.sections) {
    rows.push({ kind: "head", section: s });
    if (!p.collapsed.has(s.name)) for (const l of s.lines) rows.push({ kind: "line", line: l });
  }
  const [active, setActive] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const r0 = Math.min(active.r, rows.length - 1);
  const at = { r: r0, c: rows[r0]?.kind === "head" ? 0 : active.c };

  const cellEl = useCallback((r: number, c: number) => gridRef.current?.querySelector<HTMLElement>(`[data-cell="${r}:${c}"]`) ?? null, []);
  const visible = (el: HTMLElement | null) => !!el && el.offsetParent !== null;

  function move(r: number, c: number) {
    const target = rows[r];
    if (!target) return;
    let col = target.kind === "head" ? 0 : c;
    // Skip columns the current layout hides (Unit / Rate on tablet; REF, Qty, open on phone).
    if (target.kind === "line") {
      const step = c >= at.c ? 1 : -1;
      while (col >= 0 && col < LINE_COLS && !visible(cellEl(r, col))) col += step;
      if (col < 0 || col >= LINE_COLS) {
        col = at.c;
        if (!visible(cellEl(r, col))) col = [1, 5, 2, 0].find((x) => visible(cellEl(r, x))) ?? 1;
      }
    }
    setActive({ r, c: col });
    cellEl(r, col)?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const row = rows[at.r];
    if (!row) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(Math.min(at.r + 1, rows.length - 1), at.c);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(Math.max(at.r - 1, 0), at.c);
        break;
      case "ArrowRight":
        if (row.kind === "line") {
          e.preventDefault();
          move(at.r, Math.min(at.c + 1, LINE_COLS - 1));
        }
        break;
      case "ArrowLeft":
        if (row.kind === "line") {
          e.preventDefault();
          move(at.r, Math.max(at.c - 1, 0));
        }
        break;
      case "Home":
        e.preventDefault();
        move(e.ctrlKey ? 0 : at.r, 0);
        break;
      case "End":
        e.preventDefault();
        move(e.ctrlKey ? rows.length - 1 : at.r, LINE_COLS - 1);
        break;
      case "Enter":
        if (row.kind === "line") {
          e.preventDefault();
          p.onOpenLine(row.line.key, cellEl(at.r, at.c));
        }
        break;
      case "Escape":
        if (p.onEscape()) e.preventDefault();
        break;
    }
  }

  const tab = (r: number, c: number) => (r === at.r && c === at.c ? 0 : -1);
  const onFocusCell = (r: number, c: number) => () => {
    if (r !== at.r || c !== at.c) setActive({ r, c });
  };

  let r = 0;
  return (
    <div ref={gridRef} role="grid" aria-label="Bill of quantities" className="border-t border-bp-line-strong" onKeyDown={onKeyDown} data-boq-grid="">
      <div role="rowgroup" className="bp-boq-colhead bg-bp-surface-base">
        <div role="row" className="bp-boq-cols h-10 border-b border-bp-line-strong t-label-caps text-bp-ink-tertiary">
          <div role="columnheader" className="bp-boq-col-ref px-4">REF</div>
          <div role="columnheader" className="bp-boq-col-title px-4">DESCRIPTION</div>
          <div role="columnheader" className="bp-boq-col-qty px-4 text-right">QTY</div>
          <div role="columnheader" className="bp-boq-col-unit px-2">UNIT</div>
          <div role="columnheader" className="bp-boq-col-rate px-4 text-right">RATE AED</div>
          <div role="columnheader" className="bp-boq-col-amount px-4 text-right">AMOUNT AED</div>
          <div role="columnheader" className="bp-boq-col-open">
            <span className="sr-only">Open</span>
          </div>
        </div>
      </div>

      {p.sections.map((s) => {
        const open = !p.collapsed.has(s.name);
        const headRow = r++;
        return (
          <div role="rowgroup" key={s.name} aria-labelledby={`${sectionDomId(s.code)}-name`} data-section={s.name}>
            <div role="row" className="bp-boq-sechead border-b border-bp-line-hairline bg-bp-surface-sunken">
              <div role="gridcell" aria-colspan={LINE_COLS}>
                <button
                  type="button"
                  id={sectionDomId(s.code)}
                  data-cell={`${headRow}:0`}
                  tabIndex={tab(headRow, 0)}
                  onFocus={onFocusCell(headRow, 0)}
                  aria-expanded={open}
                  aria-controls={linesDomId(s.code)}
                  onClick={() => p.onToggleSection(s.name)}
                  className="bp-boq-cols h-11 w-full text-left hover:bg-bp-surface-raised"
                >
                  <span className="bp-boq-col-ref flex items-center gap-2 px-4 t-label-md text-bp-ink-tertiary">
                    <Icon name={open ? "expand_more" : "chevron_right"} size={16} />
                    {s.code}
                  </span>
                  <span className="bp-boq-col-title flex min-w-0 items-baseline gap-2 px-4">
                    <span id={`${sectionDomId(s.code)}-name`} className="t-heading-sm whitespace-nowrap text-bp-ink-primary">
                      {s.name}
                    </span>
                    <span className="t-label-md min-w-0 truncate text-bp-ink-tertiary">
                      {linesWord(s.lines.length)}
                      {s.tbp > 0 ? ` · ${s.tbp} to be priced` : ""}
                    </span>
                  </span>
                  <span className="bp-boq-col-sectotal px-4 text-right">
                    {s.tier ? <Figure value={s.subtotal} tier={s.tier} persona={p.persona} /> : null}
                  </span>
                </button>
              </div>
            </div>
            <div id={linesDomId(s.code)} hidden={!open}>
              {s.lines.map((l) => {
                const row = r++;
                const selected = p.selectedKey === l.key;
                return (
                  <LineRow
                    key={l.key}
                    line={l}
                    row={row}
                    selected={selected}
                    tab={tab}
                    onFocusCell={onFocusCell}
                    onOpen={(el) => p.onOpenLine(l.key, el)}
                    persona={p.persona}
                    handlers={p}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LineRow({
  line,
  row,
  selected,
  tab,
  onFocusCell,
  onOpen,
  persona,
  handlers,
}: {
  line: ReviewLine;
  row: number;
  selected: boolean;
  tab: (r: number, c: number) => number;
  onFocusCell: (r: number, c: number) => () => void;
  onOpen: (el: HTMLElement | null) => void;
  persona: Persona;
  handlers: FigureHandlers;
}) {
  const h = handlers;
  const isMouse = (e: PointerEvent) => e.pointerType === "mouse" || e.pointerType === "pen";
  const fig = (role: FigureRole, c: number, cls: string, content: React.ReactNode) => (
    <div
      role="gridcell"
      data-cell={`${row}:${c}`}
      tabIndex={tab(row, c)}
      className={`${cls} px-4 text-right outline-offset-[-2px]`}
      onFocus={(e) => {
        onFocusCell(row, c)();
        if (e.currentTarget.matches(":focus-visible")) h.onFigureFocus(line, role, e.currentTarget);
      }}
      onBlur={h.onFigureBlur}
      onPointerEnter={(e) => isMouse(e) && h.onFigureEnter(line, role, e.currentTarget)}
      onPointerLeave={(e) => isMouse(e) && h.onFigureLeave()}
      {...(h.popoverFor === `${line.ref}:${role}` ? { "aria-describedby": POPOVER_ID } : {})}
    >
      {content}
    </div>
  );

  return (
    <div
      role="row"
      id={rowDomId(line.ref)}
      aria-selected={selected}
      data-ref={line.ref}
      data-line-key={line.key}
      {...(line.derivedNote ? { "data-derived-line": "true" } : {})}
      {...(line.unpriced ? { "data-unpriced": "true" } : {})}
      onClick={(e) => {
        // A click anywhere on the row opens it (the chevron is the same action, labelled).
        if ((e.target as HTMLElement).closest("a")) return;
        onOpen(e.currentTarget as HTMLElement);
      }}
      className={`bp-boq-cols bp-boq-line relative min-h-11 cursor-pointer border-b border-bp-line-hairline py-2.5 hover:bg-bp-surface-raised ${
        selected ? "bg-bp-surface-raised before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-bp-brass before:content-['']" : ""
      }`}
    >
      <div role="gridcell" data-cell={`${row}:0`} tabIndex={tab(row, 0)} onFocus={onFocusCell(row, 0)} className="bp-boq-col-ref whitespace-nowrap pl-4 t-label-md text-bp-ink-tertiary">
        {line.ref}
      </div>
      <div role="gridcell" data-cell={`${row}:1`} tabIndex={tab(row, 1)} onFocus={onFocusCell(row, 1)} className="bp-boq-col-title min-w-0 px-4" title={line.description}>
        <span className="bp-boq-title t-body-sm text-bp-ink-primary">{line.description}</span>
      </div>
      {fig("qty", 2, "bp-boq-col-qty", <Figure value={line.quantity} tier={line.tiers.qty} format="qty" role="qty" persona={persona} />)}
      <div role="gridcell" data-cell={`${row}:3`} tabIndex={tab(row, 3)} onFocus={onFocusCell(row, 3)} className="bp-boq-col-unit whitespace-nowrap pl-2 t-label-md text-bp-ink-secondary">
        {displayUnit(line.unit)}
      </div>
      {fig(
        "rate",
        4,
        "bp-boq-col-rate",
        <Figure
          value={line.rate}
          tier={line.tiers.rate}
          role="rate"
          persona={persona}
          description={line.unpriced ? undefined : describeFigure(`AED ${formatAED(line.rate)} per ${displayUnit(line.unit)}`, line.tiers.rate, { persona, role: "rate" })}
        />,
      )}
      {fig(
        "amount",
        5,
        "bp-boq-col-amount",
        <Figure value={line.amount} tier={line.tiers.amount} role="amount" inputs={line.tiers} persona={persona} />,
      )}
      <div role="gridcell" data-cell={`${row}:6`} tabIndex={tab(row, 6)} onFocus={onFocusCell(row, 6)} className="bp-boq-col-open flex justify-center text-bp-ink-tertiary">
        <Icon name={selected ? "chevron_left" : "chevron_right"} size={16} />
        <span className="sr-only">{selected ? `${line.ref} is open in the inspector` : `Open ${line.ref} in the inspector`}</span>
      </div>
      {/* Phone: the second line — REF · qty unit × rate + the quantity mark (26:924). */}
      <div className="bp-boq-sub px-4 t-label-md text-bp-ink-tertiary" aria-hidden="true">
        {line.ref} · {line.unpriced ? `${formatQty(line.quantity)} ${displayUnit(line.unit)} · to be priced` : `${formatQty(line.quantity)} ${displayUnit(line.unit)} × ${formatAED(line.rate)}`}{" "}
        <ProvenanceMark tier={line.tiers.qty} />
      </div>
    </div>
  );
}


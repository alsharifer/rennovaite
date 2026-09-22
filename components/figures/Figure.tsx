"use client";

// =============================================================================
// components/figures/Figure.tsx — every AED figure on screen (I4).
//
//   <Figure value={n} format="amount" provenance={p} />
//
// Formats through lib/format/aed.ts (the only AED formatter) and, when it has a
// provenance, opens the source chain on hover, focus or tap: plan geometry →
// resolution tier → curated source → QS validation → flags. A figure whose
// source could not be traced says so in the popover and is marked
// `data-provenance="gap"` — it is never shown as if it had a source.
//
// One popover per page: <FigureProvenanceProvider> owns a single base-ui
// Popover driven by a handle, and each figure is a detached trigger passing its
// provenance as the payload — so a 60-line BoQ is one popup, not 200.
// =============================================================================

import { Popover } from "@base-ui/react/popover";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { formatAed, type AedFormat } from "@/lib/format/aed";
import type { ChainStepKind, FigureProvenance } from "@/lib/provenance/types";
import { cn } from "@/lib/utils";

type Handle = ReturnType<typeof Popover.createHandle<FigureProvenance>>;
const HandleContext = createContext<Handle | null>(null);

const KIND_LABEL: Record<ChainStepKind, string> = {
  geometry: "Plan",
  rule: "Take-off",
  tier: "Resolution tier",
  source: "Source",
  qs: "QS",
  arith: "Arithmetic",
  flag: "Flag",
};

export function FigureProvenanceProvider({ children }: { children: ReactNode }) {
  const handle = useMemo(() => Popover.createHandle<FigureProvenance>(), []);
  return (
    <HandleContext.Provider value={handle}>
      {children}
      <Popover.Root handle={handle}>
        {({ payload }) =>
          payload ? (
            <Popover.Portal>
              <Popover.Positioner side="top" sideOffset={8} collisionPadding={16} className="z-50">
                <Popover.Popup
                  data-provenance-popup=""
                  className="w-[360px] max-w-[calc(100vw-32px)] rounded-md border border-ink-100 bg-paper p-md text-left shadow-level-2 outline-none"
                >
                  <ProvenanceCard p={payload} />
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          ) : null
        }
      </Popover.Root>
    </HandleContext.Provider>
  );
}

function ProvenanceCard({ p }: { p: FigureProvenance }) {
  return (
    <div className="flex flex-col gap-sm">
      <Popover.Title className="font-body text-body-sm font-semibold text-ink-900">{p.title}</Popover.Title>
      {!p.traceable && (
        <p className="rounded border border-[#9d3e1d]/40 bg-[#FDF3EE] px-sm py-xs font-body text-[12px] leading-4 text-[#9d3e1d]" data-provenance-gap="">
          Source not traceable — {p.gap ?? "no source recorded for this figure"}.
        </p>
      )}
      <ol className="flex flex-col gap-xs">
        {p.steps.map((s, i) => (
          <li key={i} className="flex flex-col border-l-2 border-bone pl-sm" data-step-kind={s.kind}>
            <span className={cn("label-caps", s.kind === "tier" ? "text-brass-600" : "text-ink-500")}>
              {s.label.toLowerCase().startsWith(KIND_LABEL[s.kind].toLowerCase()) ? s.label : `${KIND_LABEL[s.kind]} · ${s.label}`}
            </span>
            <span className="font-body text-[12px] leading-4 text-ink-700">{s.detail}</span>
          </li>
        ))}
      </ol>
      {p.flags.length > 0 && (
        <ul className="flex flex-wrap gap-xs">
          {p.flags.map((f) => (
            <li key={f} className="rounded border border-ink-100 bg-canvas px-1.5 py-0.5 font-body text-[11px] text-ink-700">
              {f}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface FigureProps {
  value: number | null | undefined;
  format?: AedFormat;
  /** Printed instead of the formatted value (e.g. the derived "≈ AED 148,200*"). */
  text?: string;
  provenance?: FigureProvenance | null;
  className?: string;
}

export function Figure({ value, format = "aed", text, provenance, className }: FigureProps) {
  const handle = useContext(HandleContext);
  const shown = text ?? formatAed(value, format);
  if (!provenance || !handle) {
    return (
      <span data-figure="" data-provenance="none" className={cn("tabular-nums", className)}>
        {shown}
      </span>
    );
  }
  return (
    <Popover.Trigger
      handle={handle}
      payload={provenance}
      openOnHover
      delay={120}
      closeDelay={80}
      data-figure=""
      data-provenance={provenance.traceable ? "traced" : "gap"}
      aria-label={`${shown} — show where this figure comes from`}
      className={cn(
        "focus-ring inline cursor-help rounded-sm bg-transparent p-0 text-inherit tabular-nums underline decoration-dotted underline-offset-4 transition-colors",
        provenance.traceable ? "decoration-ink-100 hover:decoration-brass-600" : "decoration-[#9d3e1d]",
        className,
      )}
    >
      {shown}
    </Popover.Trigger>
  );
}

"use client";

// =============================================================================
// components/blueprint/plan/PlanInspector.tsx — the 2D plan's tap-to-inspect
// panel in read mode (P4; Blueprint fork, K8 — replaces the Atelier
// components/viewer/InspectPanel). Modelled on the 3D view's ViewerInspector:
// INSPECT eyebrow, the element's dimensions and current finish as hairline
// rows, then IN YOUR COST — every BoQ line whose element_refs name it, each
// linking to its row in the BoQ (/boq?highlight=<REF>). No amount is printed
// here: an AED figure belongs with its provenance mark, which lives on the BoQ
// row. When nothing maps, it says so. View-only: nothing here edits geometry.
// =============================================================================

import Link from "next/link";
import { useEffect, useRef } from "react";

import { findBoqLines, hasUnmappedLines, type InspectBoq, type InspectTarget } from "@/lib/viewer/inspect";

import { displayUnit } from "../boq/format";
import { Icon } from "../Icon";

export function PlanInspector({ target, boq, projectId, onClose }: { target: InspectTarget; boq: InspectBoq; projectId: string; onClose: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const key = target.elementIds.join(",");
  // A new selection is announced by moving focus to its heading (which also
  // brings the panel, under the canvas, into view).
  useEffect(() => {
    heading.current?.focus();
  }, [key]);

  const lines = findBoqLines(boq, target.elementIds);
  return (
    <aside aria-labelledby="plan-inspect-h" className="border border-bp-line-hairline bg-bp-surface-base px-5 py-5" data-plan-inspector>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="t-label-caps text-bp-ink-tertiary">{target.roomName && target.kind !== "room" ? `INSPECT · ${target.roomName.toUpperCase()}` : "INSPECT"}</p>
          <h2 id="plan-inspect-h" ref={heading} tabIndex={-1} className="t-heading-md mt-2 text-bp-ink-primary outline-none">
            {target.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the inspector"
          className="mt-0.5 inline-flex size-8 items-center justify-center text-bp-ink-secondary hover:text-bp-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring"
        >
          <Icon name="close" className="text-[18px]" />
        </button>
      </div>

      {target.dims.length || target.finish ? (
        <dl className="mt-3">
          {target.dims.map((d) => (
            <div key={d.label} className="flex items-baseline justify-between gap-3 border-b border-bp-line-hairline py-3">
              <dt className="t-body-sm text-bp-ink-secondary">{d.label}</dt>
              <dd className="t-num-sm text-right text-bp-ink-primary">{d.value}</dd>
            </div>
          ))}
          {target.finish ? (
            <div className="flex items-baseline justify-between gap-3 border-b border-bp-line-hairline py-3">
              <dt className="t-body-sm text-bp-ink-secondary">Current finish</dt>
              <dd className="t-body-sm text-right text-bp-ink-primary">{target.finish}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <section aria-labelledby="plan-in-cost-h" className="mt-6">
        <h3 id="plan-in-cost-h" className="t-label-caps text-bp-ink-tertiary">
          IN YOUR COST
        </h3>
        {lines.length ? (
          <ul className="mt-1">
            {lines.map((l) => (
              <li key={l.ref} className="border-b border-bp-line-hairline">
                <Link href={`/project/${projectId}/boq?highlight=${encodeURIComponent(l.ref)}`} className="block py-2.5 hover:bg-bp-surface-sunken">
                  <span className="t-label-md block font-bp-mono text-bp-ink-tertiary">{l.ref}</span>
                  <span className="t-body-sm block text-bp-ink-primary">{l.description}</span>
                  <span className="t-num-sm block text-bp-ink-secondary">
                    {l.quantity.toLocaleString("en-US", { maximumFractionDigits: 2 })} {displayUnit(l.unit)}
                    {l.work_section ? ` · ${l.work_section}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="t-body-sm mt-1.5 text-bp-ink-secondary">Priced with the whole project — not itemised on its own.</p>
        )}
        {hasUnmappedLines(boq) ? <p className="t-body-sm mt-3 text-bp-ink-tertiary">Project-wide costs (preliminaries, allowances) are not listed here.</p> : null}
      </section>
    </aside>
  );
}

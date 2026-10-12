"use client";

// =============================================================================
// components/blueprint/viewer/ViewerInspector.tsx — the 3D view's 300 px
// inspector (K8 #9, spec §6.8, Figma 62:1017). A room: its measured facts from
// the plan graph (lib/viewer/room-facts) with a mark on each — measured, or
// estimated where the graph defaulted it — "Render this room" and "Show on
// plan". A wall: its dimensions. Either way, the BoQ lines that name it
// (lib/viewer/inspect, the P4 element_refs), each linking to its row in the
// BoQ — where the figure and its mark live; no amount is printed here.
// View-only: nothing here edits geometry.
// =============================================================================

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";

import { findBoqLines, hasUnmappedLines, type InspectBoq, type InspectTarget } from "@/lib/viewer/inspect";
import { tierLabel } from "@/lib/provenance/tier-vocab";
import { wallsLine, type RoomFacts } from "@/lib/viewer/room-facts";

import { Button } from "../Button";
import { Icon } from "../Icon";
import { ProvenanceMark } from "../ProvenanceMark";
import { displayUnit } from "../boq/format";

const fmt = (n: number, dp: number) => n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

function Row({ label, value, derived, said }: { label: string; value: string; derived?: boolean; said?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-bp-line-hairline py-3">
      <dt className="t-body-sm text-bp-ink-secondary">{label}</dt>
      <dd className="flex items-center gap-1.5">
        <span aria-hidden={derived === undefined ? undefined : "true"} className="t-num-sm text-right text-bp-ink-primary">
          {value}
        </span>
        {derived === undefined ? null : (
          <>
            <ProvenanceMark tier={derived ? "derived" : "measured"} />
            <span className="sr-only">
              {said ?? value}, {tierLabel(derived ? "derived" : "measured", "owner").toLowerCase()}
            </span>
          </>
        )}
      </dd>
    </div>
  );
}

export function ViewerInspector({ projectId, boq, target, facts, onClose }: { projectId: string; boq: InspectBoq; target: InspectTarget | null; facts: RoomFacts | null; onClose: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const key = target ? target.elementIds.join(",") : "";
  // A new selection is announced by moving focus to its heading only when the
  // keyboard chose it (a label button); a click on the model keeps focus put.
  useEffect(() => {
    if (key && document.activeElement?.closest("[data-viewer]") && document.activeElement?.tagName === "BUTTON") heading.current?.focus();
  }, [key]);

  const lines = target ? findBoqLines(boq, target.elementIds) : [];
  let body: ReactNode;
  if (!target) {
    body = <p className="t-body-sm mt-3 text-bp-ink-secondary">Select a room — on the model or by its label — to see its measurements and where it sits in your cost.</p>;
  } else if (facts) {
    const anyDerived = facts.area_derived || facts.ceiling_derived || facts.perimeter_derived;
    body = (
      <>
        <dl className="mt-3">
          <Row label="Floor area" value={`${fmt(facts.area_m2, 1)} m²`} derived={facts.area_derived} said={`${fmt(facts.area_m2, 1)} square metres`} />
          {facts.unroofed ? <Row label="Ceiling" value="open to the sky" /> : facts.ceiling_h_m != null ? <Row label="Ceiling height" value={`${fmt(facts.ceiling_h_m, 2)} m`} derived={facts.ceiling_derived} /> : null}
          <Row label="Walls" value={wallsLine(facts)} />
          <Row label="Perimeter" value={`${fmt(facts.perimeter_m, 1)} m`} derived={facts.perimeter_derived} />
        </dl>
        <p className="t-body-sm mt-3 text-bp-ink-secondary">
          Measured from your plan — the same geometry the cost uses.{anyDerived ? " A half mark is an estimate the plan does not state." : ""}
        </p>
        <div className="mt-4 flex flex-col items-start gap-2">
          <Button kind="secondary" href={`/project/${projectId}/render?room=${encodeURIComponent(facts.id)}`}>
            Render this room
          </Button>
          <Button kind="quiet" href={`/project/${projectId}/plan?room=${encodeURIComponent(facts.id)}`}>
            Show on plan
          </Button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <dl className="mt-3">
          {target.dims.map((d) => (
            <Row key={d.label} label={d.label} value={d.value} />
          ))}
        </dl>
        <p className="t-body-sm mt-3 text-bp-ink-secondary">Walls are drawn from the room outlines on your plan.</p>
      </>
    );
  }

  return (
    <aside aria-labelledby="inspect-h" className="border-t border-bp-line-hairline bg-bp-surface-base px-5 py-6 lg:border-l lg:border-t-0" data-viewer-inspector>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="t-label-caps text-bp-ink-tertiary">{target && target.kind !== "room" && target.roomName ? `INSPECT · ${target.roomName.toUpperCase()}` : "INSPECT"}</p>
          <h2 id="inspect-h" ref={heading} tabIndex={-1} className="t-heading-md mt-2 text-bp-ink-primary outline-none">
            {target ? target.title : "Nothing selected"}
          </h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close the inspector" className="mt-0.5 text-bp-ink-secondary hover:text-bp-ink-primary">
          <Icon name="close" className="text-[18px]" />
        </button>
      </div>
      {body}
      {target ? (
        <section aria-labelledby="in-cost-h" className="mt-6">
          <h3 id="in-cost-h" className="t-label-caps text-bp-ink-tertiary">
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
      ) : null}
    </aside>
  );
}

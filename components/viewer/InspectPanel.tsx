"use client";

// =============================================================================
// components/viewer/InspectPanel.tsx — tap-to-inspect panel (Prompt P4).
//
// One component, two hosts (3D viewer + 2D plan). Given an InspectTarget and the
// BoQ, it shows the element's name/room, dimensions, current finish, and every
// BoQ line whose element_refs include it — each row deep-linking to the BoQ
// with that row highlighted. When nothing maps, it says so honestly.
// View-only: nothing here edits geometry.
// =============================================================================

import Link from "next/link";

import {
  findBoqLines,
  hasUnmappedLines,
  type InspectBoq,
  type InspectTarget,
} from "@/lib/viewer/inspect";

function formatAed(n: number): string {
  return `AED ${Math.round(n).toLocaleString("en-US")}`;
}

export function InspectPanel({
  target,
  boq,
  projectId,
  onClose,
}: {
  target: InspectTarget;
  boq: InspectBoq;
  projectId: string;
  onClose: () => void;
}) {
  const lines = findBoqLines(boq, target.elementIds);
  const showProjectLevel = hasUnmappedLines(boq);

  return (
    <aside className="fixed right-0 top-16 z-30 flex h-[calc(100vh-4rem)] w-[360px] flex-col gap-lg overflow-y-auto border-l border-ink-100 bg-paper p-lg shadow-level-2">
      <div className="flex items-start justify-between gap-md">
        <div>
          {target.roomName && target.kind !== "room" && (
            <p className="label-caps text-ink-500">{target.roomName}</p>
          )}
          <h3 className="font-display text-headline-md text-ink-900">{target.title}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="focus-ring flex size-8 items-center justify-center rounded text-on-surface-variant hover:text-ink-900"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      {/* Dimensions (Mono) */}
      <div className="flex flex-col gap-sm">
        <p className="label-caps text-ink-500">Dimensions</p>
        {target.dims.map((d) => (
          <div key={d.label} className="flex items-baseline justify-between border-b border-bone pb-xs">
            <span className="font-body-sm text-body-sm text-on-surface-variant">{d.label}</span>
            <span className="font-mono text-body-sm tabular-nums text-ink-900">{d.value}</span>
          </div>
        ))}
      </div>

      {/* Current finish */}
      {target.finish && (
        <div className="flex flex-col gap-xs">
          <p className="label-caps text-ink-500">Current finish</p>
          <p className="font-body-sm text-body-sm text-ink-900">{target.finish}</p>
        </div>
      )}

      {/* ON YOUR BoQ */}
      <div className="flex flex-col gap-sm">
        <p className="label-caps text-brass-600">On your BoQ</p>
        {lines.length === 0 ? (
          <p className="rounded-md border border-ink-100 bg-canvas p-md font-body-sm text-body-sm text-on-surface-variant">
            Priced at project level — this element isn&apos;t itemised on its own.
          </p>
        ) : (
          <ul className="flex flex-col gap-xs">
            {lines.map((l) => (
              <li key={l.ref}>
                <Link
                  href={`/project/${projectId}/boq?highlight=${l.ref}`}
                  className="focus-ring flex flex-col gap-xs rounded-md border border-ink-100 bg-paper p-md transition-colors hover:bg-surface-container"
                >
                  <span className="flex items-center justify-between gap-md">
                    <span className="font-mono text-[12px] text-ink-500">{l.ref}</span>
                    <span className="flex items-center gap-xs">
                      {l.needs_qs && (
                        <span className="inline-block size-1.5 rounded-full bg-tertiary" title="Rate to be confirmed by the QS" />
                      )}
                      <span className="font-mono text-body-sm tabular-nums text-ink-900">
                        {formatAed(l.total_aed)}
                      </span>
                    </span>
                  </span>
                  <span className="font-body-sm text-body-sm text-ink-900">{l.description}</span>
                  <span className="font-mono text-[12px] text-on-surface-variant">
                    {l.quantity.toLocaleString("en-US")} {l.unit} · {l.work_section}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showProjectLevel && (
        <p className="mt-auto border-t border-bone pt-md font-body-sm text-[12px] italic text-on-surface-variant">
          Some project-level costs (preliminaries, provisional sums) are not shown here.
        </p>
      )}
    </aside>
  );
}

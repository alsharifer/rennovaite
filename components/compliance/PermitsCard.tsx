"use client";

// =============================================================================
// components/compliance/PermitsCard.tsx — PERMITS & APPROVALS card (P6).
//
// One row per fired permit-trigger rule with an authority chip, consequence,
// and an expandable explanation + cited source. Zero fired → the calm state.
// Guidance, not legal advice.
// =============================================================================

import { useState } from "react";

import type { CommunityAuthority } from "@/lib/compliance/authorities";
import type { Consequence, FiredRule } from "@/lib/compliance/dubai-triggers";

const CONSEQUENCE_LABEL: Record<Consequence, string> = {
  permit_required: "Permit required",
  noc_required: "NOC required",
  approval_likely: "Approval likely",
  no_permit: "No permit",
};

function AuthorityChip({
  authority,
  developer,
}: {
  authority: FiredRule["authority"];
  developer: string;
}) {
  const map: Record<FiredRule["authority"], { label: string; cls: string }> = {
    DM: { label: "DM", cls: "bg-secondary-container text-on-secondary-container" },
    DDA: { label: "DDA", cls: "bg-primary-fixed text-ink-900" },
    Trakhees: { label: "Trakhees", cls: "bg-tertiary-container text-on-tertiary-container" },
    community_developer: { label: developer, cls: "bg-bone text-ink-700" },
  };
  const c = map[authority];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${c.cls}`}>
      {c.label}
    </span>
  );
}

export function PermitsCard({
  fired,
  community,
  className = "",
}: {
  fired: FiredRule[];
  community: CommunityAuthority;
  className?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section className={`rounded-xl border border-ink-100 bg-paper p-lg ${className}`}>
      <div className="mb-md flex items-start justify-between gap-md">
        <p className="label-caps text-brass-600">Permits &amp; approvals</p>
        <p className="max-w-[280px] text-right font-body-sm text-[11px] italic text-on-surface-variant">
          Guidance, not legal advice — your assigned consultant confirms before contract.
        </p>
      </div>

      {fired.length === 0 ? (
        <div className="rounded-md border border-ink-100 bg-canvas p-md">
          <p className="font-body text-body-md text-ink-900">
            Your scope needs no permit as designed — finishes-level works.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-xs">
          {fired.map((r) => {
            const expanded = open === r.id;
            return (
              <li key={r.id} className="rounded-md border border-ink-100">
                <button
                  type="button"
                  onClick={() => setOpen((cur) => (cur === r.id ? null : r.id))}
                  aria-expanded={expanded}
                  className="focus-ring flex w-full items-center gap-md px-md py-sm text-left transition-colors hover:bg-surface-container-low"
                >
                  <AuthorityChip authority={r.authority} developer={community.developer} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-body-sm text-body-sm font-semibold text-ink-900">
                      {r.title_en}
                    </span>
                  </span>
                  <span className="label-caps shrink-0 text-on-surface-variant">
                    {CONSEQUENCE_LABEL[r.consequence]}
                  </span>
                  <span
                    className="material-symbols-outlined text-[18px] text-on-surface-variant"
                    style={{ transform: expanded ? "rotate(90deg)" : "none" }}
                    aria-hidden="true"
                  >
                    chevron_right
                  </span>
                </button>
                {expanded && (
                  <div className="border-t border-bone px-md py-md">
                    <p className="font-body-sm text-body-sm text-ink-900">{r.explanation_en}</p>
                    <p className="mt-sm font-body-sm text-[11px] text-ink-500">
                      Source: {r.source_note}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

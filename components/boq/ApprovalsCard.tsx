import Link from "next/link";

import { approvalLabel } from "@/lib/boq/approval-label";
import type { RevisionSummary } from "@/lib/boq/revisions";
import { formatAed } from "@/lib/format/aed";
import { cn } from "@/lib/utils";

// U4 — the project hub's view of the approval trail: the latest revisions, who
// approved which, and the way to the diff. Server component; renders nothing
// when the project has no BoQ yet.

const day = (iso: string) => iso.slice(0, 10);

export function ApprovalsCard({ projectId, revisions, className }: { projectId: string; revisions: RevisionSummary[]; className?: string }) {
  if (revisions.length === 0) return null;
  const shown = revisions.slice(0, 4);
  const approved = revisions.filter((r) => r.approvals.firm).length;
  return (
    <section className={cn("rounded-xl border border-ink-100 bg-paper p-lg", className)} aria-label="BoQ approvals" data-testid="approvals-card">
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <p className="label-caps text-ink-500">BoQ revisions &amp; approvals</p>
        <Link href={`/project/${projectId}/boq/revisions`} className="focus-ring font-body text-body-sm font-semibold text-brass-600 hover:underline">
          Compare revisions →
        </Link>
      </div>
      <h2 className="mt-xs font-display text-headline-md leading-tight text-ink-900">
        {revisions.length} revision{revisions.length === 1 ? "" : "s"} <span className="text-on-surface-variant">·</span> {approved} approved by the firm
      </h2>
      <ol className="mt-md divide-y divide-ink-100">
        {shown.map((r, i) => (
          <li key={r.boq_id} className="flex flex-wrap items-baseline justify-between gap-sm py-sm" data-revision={r.boq_id}>
            <div className="flex items-baseline gap-sm">
              <span className={cn("size-2 rounded-full", i === 0 ? "bg-brass-600" : "border border-brass-600 bg-paper")} aria-hidden="true" />
              <span className="font-mono text-body-sm tabular-nums text-ink-900">{day(r.created_at)}</span>
              <span className="font-mono text-body-sm tabular-nums text-ink-700">{formatAed(r.grand_total_aed, "amount")}</span>
              {r.draft && <span className="label-caps text-[#9d3e1d]">draft</span>}
            </div>
            <div className="text-right text-body-sm text-ink-700">
              {r.approvals.trail.length === 0 ? <span className="text-ink-500">not approved</span> : r.approvals.trail.map((a) => <div key={a.id}>{approvalLabel(a)}</div>)}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

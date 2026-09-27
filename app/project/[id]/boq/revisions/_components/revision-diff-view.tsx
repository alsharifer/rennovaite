"use client";

import { useRouter } from "next/navigation";

import { Figure, FigureProvenanceProvider } from "@/components/figures/Figure";
import { approvalLabel } from "@/lib/boq/approval-label";
import type { DiffLine } from "@/lib/boq/revision-diff";
import { CAUSE_KIND_LABEL, DIFF_CLASS_LABEL } from "@/lib/boq/revision-diff-types";
import type { ProjectRevisionDiff, RevisionSummary } from "@/lib/boq/revisions";
import { formatAed } from "@/lib/format/aed";
import type { ChainStep, FigureProvenance, LineProvenance } from "@/lib/provenance/types";
import { cn } from "@/lib/utils";

// U4 — the diff, on screen. Every figure is a <Figure>: the old and new
// quantity / rate / total open the stored revision's own provenance chain; the
// delta opens the arithmetic plus the recorded cause(s), or says none was recorded.

const day = (iso: string) => iso.slice(0, 10);
const short = (id: string) => id.slice(0, 8);

function deltaProvenance(l: DiffLine): FigureProvenance {
  const steps: ChainStep[] = [
    { kind: "arith", label: "Δ total", detail: `${formatAed(l.new?.total_aed ?? 0, "amount")} − ${formatAed(l.old?.total_aed ?? 0, "amount")} = ${formatAed(l.delta_aed, "signed")}` },
    { kind: "arith", label: "What moved", detail: l.class === "added" ? "the line is new in the later revision" : l.class === "removed" ? "the line is gone from the later revision" : `quantity ${l.old!.quantity} → ${l.new!.quantity} ${l.unit}; rate ${formatAed(l.old!.rate_aed, "amount")} → ${formatAed(l.new!.rate_aed, "amount")}` },
    ...l.causes.map<ChainStep>((c) => ({ kind: "cause", label: `${CAUSE_KIND_LABEL[c.kind]} · ${day(c.at)}`, detail: c.summary })),
  ];
  if (l.causes.length === 0) steps.push({ kind: "cause", label: "None recorded", detail: "No correction, rate-book entry or plan event recorded between these revisions names this line." });
  return { title: `Δ — ${l.description}`, steps, flags: l.causes.length ? ["cause recorded"] : ["no cause recorded"], traceable: true };
}

function summaryDelta(label: string, d: { old: number; new: number; delta: number }): FigureProvenance {
  return { title: `Δ ${label}`, steps: [{ kind: "arith", label: "Δ", detail: `${formatAed(d.new, "amount")} − ${formatAed(d.old, "amount")} = ${formatAed(d.delta, "signed")}` }], flags: [], traceable: true };
}

export function RevisionDiffView({ projectId, revisions, result }: { projectId: string; revisions: RevisionSummary[]; result: ProjectRevisionDiff }) {
  const router = useRouter();
  const { diff, before, after, approvals } = result;
  const go = (from: string, to: string) => router.push(`/project/${projectId}/boq/revisions?from=${from}&to=${to}`);
  const prov = (doc: typeof before, l: DiffLine["old"]): LineProvenance | null => (l ? doc.provenance.lines[`${l.section}-${l.index}`] ?? null : null);
  const sections = [...new Set(diff.lines.map((l) => l.section))];
  const pdfHref = `/api/projects/${projectId}/boq-diff?from=${before.boq_id}&to=${after.boq_id}&format=pdf`;

  const picker = (label: string, value: string, onChange: (id: string) => void) => (
    <label className="flex flex-col gap-xs">
      <span className="label-caps text-ink-500">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="focus-ring rounded border border-ink-100 bg-paper px-sm py-xs font-mono text-body-sm text-ink-900">
        {revisions.map((r) => (
          <option key={r.boq_id} value={r.boq_id}>
            {day(r.created_at)} · {short(r.boq_id)} · {formatAed(r.grand_total_aed, "amount")}
            {r.draft ? " · draft" : ""}
            {r.approvals.firm ? " · approved" : ""}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <FigureProvenanceProvider>
      <section className="rounded-xl border border-ink-100 bg-paper p-lg" aria-label="Revision diff" data-diff-from={before.boq_id} data-diff-to={after.boq_id}>
        <div className="flex flex-wrap items-end justify-between gap-md">
          <div className="flex flex-wrap gap-md">
            {picker("From", before.boq_id, (v) => go(v, after.boq_id))}
            {picker("To", after.boq_id, (v) => go(before.boq_id, v))}
          </div>
          <div className="flex items-center gap-sm">
            <a href={pdfHref} className="focus-ring inline-flex h-10 items-center gap-xs rounded-lg border border-ink-100 bg-paper px-md font-body text-body-sm font-semibold text-ink-900 hover:bg-surface-container" data-testid="diff-pdf">
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                picture_as_pdf
              </span>
              Export diff PDF
            </a>
          </div>
        </div>

        <div className="mt-lg grid grid-cols-1 gap-gutter md:grid-cols-3">
          <div>
            <p className="label-caps text-ink-500">Grand total</p>
            <p className="mt-xs font-mono text-headline-md tabular-nums text-ink-900">
              <Figure value={diff.summary.grand.old} format="amount" provenance={before.provenance.summary.grand} /> <span className="text-ink-500">→</span>{" "}
              <Figure value={diff.summary.grand.new} format="amount" provenance={after.provenance.summary.grand} />
            </p>
            <p className={cn("mt-xs font-mono text-body-md tabular-nums", diff.summary.grand.delta === 0 ? "text-ink-500" : "text-ink-900")} data-testid="diff-grand-delta">
              <Figure value={diff.summary.grand.delta} format="signed" provenance={summaryDelta("grand total", diff.summary.grand)} />
              {diff.summary.delta_pct != null && <span className="ml-xs text-ink-500">({diff.summary.delta_pct >= 0 ? "+" : ""}{diff.summary.delta_pct}%)</span>}
            </p>
          </div>
          <div>
            <p className="label-caps text-ink-500">Lines</p>
            <p className="mt-xs text-body-md text-ink-700" data-testid="diff-counts">
              {diff.counts.moved} moved · {diff.counts.added} added · {diff.counts.removed} removed · {diff.unchanged} unchanged
            </p>
            <p className="mt-xs text-body-sm text-ink-500">{diff.counts.with_cause} with a recorded cause</p>
            {diff.watermark_drops && <p className="mt-xs text-body-sm text-[#9d3e1d]">The draft watermark drops between these revisions.</p>}
          </div>
          <div>
            <p className="label-caps text-ink-500">Approvals</p>
            <ul className="mt-xs space-y-xs text-body-sm text-ink-700" data-testid="diff-approvals">
              <li>
                <span className="font-mono text-ink-500">{short(before.boq_id)}</span> · {approvals.before.trail.length ? approvals.before.trail.map(approvalLabel).join(" · ") : "not approved"}
              </li>
              <li>
                <span className="font-mono text-ink-500">{short(after.boq_id)}</span> · {approvals.after.trail.length ? approvals.after.trail.map(approvalLabel).join(" · ") : "not approved"}
              </li>
            </ul>
          </div>
        </div>

        {diff.lines.length === 0 ? (
          <p className="mt-lg text-body-md text-ink-500">No line moved between these two revisions.</p>
        ) : (
          <table className="mt-lg w-full text-body-sm" data-testid="diff-lines">
            <thead>
              <tr className="label-caps text-left text-ink-500">
                <th className="py-xs pr-sm font-normal">REF</th>
                <th className="py-xs pr-sm font-normal">Line</th>
                <th className="py-xs pr-sm text-right font-normal">Qty old → new</th>
                <th className="py-xs pr-sm text-right font-normal">Rate old → new</th>
                <th className="py-xs text-right font-normal">Δ total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {sections.map((section) => (
                <SectionRows key={section} section={section} lines={diff.lines.filter((l) => l.section === section)} before={before} after={after} prov={prov} />
              ))}
            </tbody>
            <tfoot>
              <SummaryRow label="Subtotal" d={diff.summary.subtotal} oldP={before.provenance.summary.subtotal} newP={after.provenance.summary.subtotal} />
              {(diff.summary.ohp.old !== 0 || diff.summary.ohp.new !== 0) && <SummaryRow label="Overheads & profit" d={diff.summary.ohp} oldP={before.provenance.summary.ohp} newP={after.provenance.summary.ohp} />}
              <SummaryRow label="Contingency" d={diff.summary.contingency} oldP={before.provenance.summary.contingency} newP={after.provenance.summary.contingency} />
              <SummaryRow label="VAT" d={diff.summary.vat} oldP={before.provenance.summary.vat} newP={after.provenance.summary.vat} />
              <SummaryRow label="Grand total" d={diff.summary.grand} oldP={before.provenance.summary.grand} newP={after.provenance.summary.grand} strong />
            </tfoot>
          </table>
        )}

        {diff.window_causes.length > 0 && (
          <div className="mt-lg border-t border-ink-100 pt-md" data-testid="window-causes">
            <p className="label-caps text-ink-500">Recorded between these revisions</p>
            <ul className="mt-xs space-y-xs text-body-sm text-ink-700">
              {diff.window_causes.map((c, i) => (
                <li key={i}>
                  <span className="font-mono text-ink-500">{day(c.at)}</span> · {CAUSE_KIND_LABEL[c.kind]} — {c.summary}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </FigureProvenanceProvider>
  );
}

function SectionRows({ section, lines, before, after, prov }: { section: string; lines: DiffLine[]; before: ProjectRevisionDiff["before"]; after: ProjectRevisionDiff["after"]; prov: (doc: ProjectRevisionDiff["before"], l: DiffLine["old"]) => LineProvenance | null }) {
  return (
    <>
      <tr>
        <td colSpan={5} className="pt-md pb-xs label-caps text-brass-600">
          {section}
        </td>
      </tr>
      {lines.map((l) => {
        const po = prov(before, l.old);
        const pn = prov(after, l.new);
        const ref = l.new ? after.refs[`${l.section}-${l.new.index}`] : `${before.refs[`${l.section}-${l.old!.index}`] ?? ""}†`;
        return (
          <tr key={l.key} data-line-key={l.key} data-class={l.class} className={cn("align-top", l.class === "removed" && "text-ink-500")}>
            <td className="py-sm pr-sm font-mono text-[12px] text-ink-500">{ref}</td>
            <td className="py-sm pr-sm">
              <div className="text-ink-900">{l.description}</div>
              <div className={cn("text-[12px]", l.class === "added" ? "text-brass-600" : l.class === "removed" ? "text-[#9d3e1d]" : "text-ink-500")}>{DIFF_CLASS_LABEL[l.class]}</div>
              {l.causes.length > 0 ? (
                <ul className="mt-xs space-y-[2px] text-[12px] text-ink-700" data-causes="recorded">
                  {l.causes.map((c, i) => (
                    <li key={i}>
                      <span className="font-mono text-ink-500">{day(c.at)}</span> · {CAUSE_KIND_LABEL[c.kind]} — {c.summary}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-xs text-[12px] text-ink-500" data-causes="none">
                  no cause recorded between these revisions
                </div>
              )}
            </td>
            <td className="py-sm pr-sm text-right font-mono tabular-nums">
              {l.old ? <Figure value={l.old.quantity} text={String(l.old.quantity)} provenance={po?.quantity ?? null} /> : "—"} <span className="text-ink-500">→</span>{" "}
              {l.new ? <Figure value={l.new.quantity} text={String(l.new.quantity)} provenance={pn?.quantity ?? null} /> : "—"} <span className="text-ink-500">{l.unit}</span>
            </td>
            <td className="py-sm pr-sm text-right font-mono tabular-nums">
              {l.old ? <Figure value={l.old.rate_aed} format="amount" provenance={po?.rate ?? null} /> : "—"} <span className="text-ink-500">→</span>{" "}
              {l.new ? <Figure value={l.new.rate_aed} format="amount" provenance={pn?.rate ?? null} /> : "—"}
            </td>
            <td className="py-sm text-right font-mono font-semibold tabular-nums text-ink-900">
              <Figure value={l.delta_aed} format="signed" provenance={deltaProvenance(l)} />
            </td>
          </tr>
        );
      })}
    </>
  );
}

function SummaryRow({ label, d, oldP, newP, strong }: { label: string; d: { old: number; new: number; delta: number }; oldP: FigureProvenance | null; newP: FigureProvenance | null; strong?: boolean }) {
  return (
    <tr className={cn("border-t border-ink-100", strong && "border-t-2 border-ink-900")}>
      <td />
      <td className={cn("py-sm pr-sm text-right", strong ? "font-semibold text-ink-900" : "text-ink-700")} colSpan={2}>
        {label}
      </td>
      <td className="py-sm pr-sm text-right font-mono tabular-nums text-ink-700">
        <Figure value={d.old} format="amount" provenance={oldP} /> <span className="text-ink-500">→</span> <Figure value={d.new} format="amount" provenance={newP} />
      </td>
      <td className={cn("py-sm text-right font-mono tabular-nums", strong ? "text-body-md font-semibold text-ink-900" : "text-ink-900")} data-summary={label}>
        <Figure value={d.delta} format="signed" provenance={summaryDelta(label, d)} />
      </td>
    </tr>
  );
}

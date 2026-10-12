"use client";

// =============================================================================
// components/blueprint/revisions/RevisionsScreen.tsx — 07 Revisions & Approval
// (K4, R7 §3.5, Figma 21:450).
//
// From / To pickers · summary chain (rev A · rev B · Δ) · the moved lines with
// their marks and RECORDED causes ("none recorded" otherwise — the diff never
// tells a story) · the reconciliation sentence · right column: the approval
// trail of the later revision (Record firm approval / Record client approval —
// the client's approval is an event the firm records) and the window events no
// line names. "Link causes to lines" has no record behind it yet: it is shown
// disabled, with that reason.
// =============================================================================

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import type { RevisionsView, ViewLine } from "@/lib/boq/revisions-view";
import { formatAED, formatDelta, formatQty } from "@/lib/format/aed";
import { tierLabel } from "@/lib/provenance/tier-vocab";

import { Button } from "../Button";
import { Figure } from "../Figure";
import { Icon } from "../Icon";
import { ProvenanceMark } from "../ProvenanceMark";
import { TopBarActions } from "../shell/TopBar";
import { displayUnit } from "../boq/format";

const SECONDARY_A =
  "inline-flex h-9 items-center gap-2 rounded-none border border-bp-line-control px-4 t-label-md text-bp-ink-primary hover:bg-bp-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring";

export function RevisionsScreen({ view, eyebrow, canApprove, approveBlock }: { view: RevisionsView; eyebrow: string; canApprove: boolean; approveBlock: string | null }) {
  const router = useRouter();
  const go = (from: string, to: string) => router.push(`/project/${view.projectId}/boq/revisions?from=${from}&to=${to}`);
  const fromId = useId();
  const toId = useId();
  const c = view.counts;

  return (
    <div className="mx-auto max-w-[1344px] px-6 py-8 lg:px-10" data-diff-from={view.from.boqId} data-diff-to={view.to.boqId}>
      <TopBarActions>
        <a href={view.pdfHref} className={`bp-desk-only ${SECONDARY_A}`} data-testid="diff-pdf">
          Export diff PDF
        </a>
      </TopBarActions>

      <p className="t-label-caps text-bp-brass-text">{eyebrow}</p>
      <h1 className="t-heading-lg mt-2 text-bp-ink-primary">What moved between two revisions</h1>

      <div className="mt-6 flex flex-wrap items-end gap-4">
        <Picker id={fromId} label="FROM" value={view.from.boqId} options={view.revisions} onChange={(v) => go(v, view.to.boqId)} />
        <Icon name="arrow_forward" className="mb-2.5 text-bp-ink-tertiary" />
        <Picker id={toId} label="TO" value={view.to.boqId} options={view.revisions} onChange={(v) => go(view.from.boqId, v)} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <div className="relative overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring" tabIndex={0} role="region" aria-label="Summary chain">
            <ChainTable view={view} />
          </div>

          <section aria-labelledby="diff-lines-h" className="mt-8">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 id="diff-lines-h" className="t-heading-md text-bp-ink-primary">
                Lines
              </h2>
              <p className="t-label-md font-bp-mono text-bp-ink-secondary" data-testid="diff-counts">
                {c.changed} changed · {c.unchanged} unchanged · {c.added} added · {c.removed} removed
                {view.classSummary ? ` · ${view.classSummary}` : ""}
              </p>
            </div>
            {view.watermarkDrops ? <p className="t-body-sm mt-2 text-bp-ink-secondary">The draft statement drops between these revisions: every boundary-critical dimension is now measured.</p> : null}
            {view.lines.length === 0 ? (
              <p className="t-body-sm mt-4 border border-dashed border-bp-line-hairline px-4 py-6 text-bp-ink-secondary">No line moved between these two revisions.</p>
            ) : (
              <LinesTable view={view} />
            )}
            <p className="t-label-md mt-3 font-bp-mono text-bp-ink-tertiary" data-testid="diff-reconciliation">
              {view.reconciliation}
            </p>
            {view.lines.some((l) => l.causes.length === 0) ? (
              <p className="t-body-sm mt-2 text-bp-ink-tertiary" id="none-recorded-note">
                <Icon name="help" size={16} className="mr-1 align-[-3px]" />
                &ldquo;none recorded&rdquo; — no correction, rate-book change or plan event recorded between rev {view.from.rev} and rev {view.to.rev} names this line. A cause is never inferred.
              </p>
            ) : null}
          </section>
        </div>

        <aside className="min-w-0 space-y-8" aria-label="Approvals and events">
          <ApprovalTrail view={view} canApprove={canApprove} approveBlock={approveBlock} onDone={() => router.refresh()} />
          <WindowEvents view={view} />
        </aside>
      </div>
    </div>
  );
}

function Picker({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: RevisionsView["revisions"]; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="t-label-caps text-bp-ink-tertiary">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 min-w-[280px] rounded-none border border-bp-line-control bg-bp-surface-raised px-3 font-bp-mono text-[13px] text-bp-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring"
      >
        {options.map((o) => (
          <option key={o.boqId} value={o.boqId}>
            {o.label}
            {o.draft ? " · draft" : ""}
            {o.approved ? " · approved" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

function ChainTable({ view }: { view: RevisionsView }) {
  return (
    <table className="w-full min-w-[520px] border-collapse" aria-label={`Summary chain, rev ${view.from.rev} and rev ${view.to.rev}`} data-testid="diff-chain">
      <thead>
        <tr className="border-b border-bp-line-strong bg-bp-surface-sunken">
          <th scope="col" className="t-label-caps px-3 py-2.5 text-left font-normal text-bp-ink-tertiary">
            <span className="sr-only">Figure</span>
          </th>
          <th scope="col" className="t-label-caps px-3 py-2.5 text-right font-normal text-bp-ink-tertiary">
            REV {view.from.rev}
          </th>
          <th scope="col" className="t-label-caps px-3 py-2.5 text-right font-normal text-bp-ink-tertiary">
            REV {view.to.rev}
          </th>
          <th scope="col" className="t-label-caps px-3 py-2.5 text-right font-normal text-bp-ink-tertiary">
            Δ AED
          </th>
        </tr>
      </thead>
      <tbody>
        {view.chain.map((r) => {
          const total = r.key === "total";
          return (
            <tr key={r.key} className={`border-b ${total ? "border-bp-line-strong" : "border-bp-line-hairline"}`} data-summary={r.key}>
              <th scope="row" className={`px-3 py-3 text-left font-normal ${total ? "t-heading-sm" : "t-body-sm"} text-bp-ink-primary`}>
                {r.label}
              </th>
              <td className="t-num-md px-3 py-3 text-right text-bp-ink-secondary">{r.old == null ? "—" : formatAED(r.old)}</td>
              <td className={`px-3 py-3 text-right text-bp-ink-primary ${total ? "t-num-lg" : "t-num-md"}`}>{r.new == null ? "—" : formatAED(r.new)}</td>
              <td className="t-num-md px-3 py-3 text-right text-bp-ink-primary" data-testid={total ? "diff-grand-delta" : undefined}>
                {formatDelta(r.delta)}
                {total && view.totalDeltaPct != null && formatDelta(view.totalDeltaPct, "pct") !== "—" ? <span className="ml-3 text-bp-ink-secondary">({formatDelta(view.totalDeltaPct, "pct")})</span> : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function arrow(a: string, b: string) {
  if (a === b) return a;
  return (
    <>
      {a} <span aria-hidden="true">→</span>
      <span className="sr-only"> to </span> {b}
    </>
  );
}

function QtyCell({ l }: { l: ViewLine }) {
  const u = displayUnit(l.unit);
  const a = l.qty.old == null ? "—" : formatQty(l.qty.old);
  const b = l.qty.new == null ? "—" : formatQty(l.qty.new);
  if (a === b) return <Figure value={l.qty.new} tier={l.qty.tier} format="qty" role="qty" unit={u} size="sm" />;
  return (
    <span className="t-num-sm inline-flex items-center gap-1.5 text-bp-ink-primary">
      <span>
        {arrow(a, b)} {u}
      </span>
      <ProvenanceMark tier={l.qty.tier} />
      <span className="sr-only">, {tierLabel(l.qty.tier, "firm", "qty")}</span>
    </span>
  );
}

function LinesTable({ view }: { view: RevisionsView }) {
  const sections = [...new Set(view.lines.map((l) => l.section))];
  return (
    // Focusable so a keyboard can scroll it sideways on a narrow screen (axe scrollable-region-focusable).
    <div className="relative mt-4 overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring" tabIndex={0} role="region" aria-label="Lines that moved">
      <table className="w-full min-w-[880px] border-collapse" data-testid="diff-lines">
        <thead>
          <tr className="border-b border-bp-line-strong bg-bp-surface-sunken">
            {["REF", "LINE", "QTY", "RATE", "AMOUNT", "Δ AED", "CAUSE"].map((h, i) => (
              <th key={h} scope="col" className={`t-label-caps whitespace-nowrap px-3 py-2.5 font-normal text-bp-ink-tertiary ${i >= 2 && i <= 5 ? "text-right" : "text-left"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        {sections.map((section) => (
          <tbody key={section}>
            <tr>
              <th scope="colgroup" colSpan={7} className="t-label-caps px-3 pb-1 pt-4 text-left font-normal text-bp-ink-secondary">
                {section}
              </th>
            </tr>
            {view.lines
              .filter((l) => l.section === section)
              .map((l) => {
                const rateA = l.rate.old == null ? "—" : formatAED(l.rate.old);
                const rateB = l.rate.new == null ? "—" : formatAED(l.rate.new);
                const amtA = l.amount.old == null ? "—" : formatAED(l.amount.old);
                const amtB = l.amount.new == null ? "—" : formatAED(l.amount.new);
                const unpricedRate = l.rate.tier === "unpriced";
                return (
                  <tr key={l.key} data-line-key={l.key} data-class={l.cls} className="border-b border-bp-line-hairline align-top">
                    <td className="t-num-sm whitespace-nowrap px-3 py-3 text-bp-ink-secondary">{l.ref}</td>
                    <td className="min-w-[200px] px-3 py-3">
                      <div className="t-body-sm text-bp-ink-primary">{l.description}</div>
                      <div className="t-label-md text-bp-ink-tertiary">{l.classLabel}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right">
                      <QtyCell l={l} />
                    </td>
                    <td className="t-num-sm whitespace-nowrap px-3 py-3 text-right text-bp-ink-primary">{unpricedRate ? "—" : arrow(rateA, rateB)}</td>
                    <td className="t-num-sm whitespace-nowrap px-3 py-3 text-right text-bp-ink-primary">{l.amount.tier === "unpriced" ? <span className="t-label-md text-bp-ink-tertiary">to be priced</span> : arrow(amtA, amtB)}</td>
                    <td className="t-num-sm whitespace-nowrap px-3 py-3 text-right text-bp-ink-primary">{formatDelta(l.delta)}</td>
                    <td className="min-w-[180px] px-3 py-3">
                      {l.causes.length === 0 ? (
                        <span className="t-label-md inline-flex items-center gap-1 text-bp-ink-tertiary" data-causes="none">
                          <Icon name="help" size={16} />
                          none recorded
                        </span>
                      ) : (
                        <ul className="space-y-1" data-causes="recorded">
                          {l.causes.map((c, i) => (
                            <li key={i} className="t-body-sm text-bp-ink-primary">
                              <span className="t-label-md text-bp-ink-tertiary">{c.day} · </span>
                              {c.href ? (
                                <Link href={c.href} className="underline decoration-bp-line-control underline-offset-2 hover:decoration-bp-ink-primary">
                                  {c.label} — {c.summary}
                                </Link>
                              ) : (
                                <>
                                  {c.label} — {c.summary}
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        ))}
      </table>
    </div>
  );
}

const METHODS = ["Signed proposal", "Email", "In person", "Message", "Other"] as const;

function ApprovalTrail({ view, canApprove, approveBlock, onDone }: { view: RevisionsView; canApprove: boolean; approveBlock: string | null; onDone: () => void }) {
  const [mode, setMode] = useState<null | "client">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [method, setMethod] = useState<string>(METHODS[0]);
  const [ref, setRef] = useState("");
  const reasonId = useId();
  const formId = useId();

  const post = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/projects/${view.projectId}/boq-approvals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ boq_id: view.to.boqId, ...body }) });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(res.status === 403 ? "Only a member of this project's firm can approve its BoQ." : res.status === 401 ? "Your session has ended — sign in again." : (j.error ?? `The request failed (${res.status}).`));
        return;
      }
      setDone(ok);
      setMode(null);
      setName("");
      setDate("");
      setRef("");
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const clientValid = name.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const blocked = !canApprove ? { reason: approveBlock ?? "Only a member of this project's firm can record an approval.", reasonId, showReason: false } : busy ? { reason: "Recording…", reasonId } : false;

  return (
    <section className="border border-bp-line-hairline bg-bp-surface-raised p-5" aria-labelledby={`${formId}-h`} data-testid="approvals-panel">
      <h2 id={`${formId}-h`} className="t-label-caps text-bp-ink-tertiary">
        APPROVAL TRAIL · REV {view.to.rev}
      </h2>
      {view.approvals.length === 0 ? (
        <p className="t-heading-sm mt-3 text-bp-ink-primary">No approvals recorded for this revision.</p>
      ) : (
        <ul className="mt-3 space-y-2" data-testid="approval-trail">
          {view.approvals.map((a) => (
            <li key={a.id} className="t-body-sm text-bp-ink-primary" data-approval-kind={a.kind}>
              <Icon name={a.kind === "firm" ? "verified" : "how_to_reg"} size={16} className="mr-1.5 align-[-3px]" />
              {a.label}
              {a.note ? <span className="text-bp-ink-secondary"> — {a.note}</span> : null}
            </li>
          ))}
        </ul>
      )}
      <p className="t-body-sm mt-3 text-bp-ink-secondary">
        A firm approval is recorded by a member of the project&rsquo;s firm. A client&rsquo;s approval is captured by you — the date, how it was given and a reference; the client needs no account. Every entry stays: the trail is append-only.
      </p>
      {!canApprove ? (
        <p id={reasonId} className="t-label-md mt-3 text-bp-ink-tertiary">
          {approveBlock ?? "Only a member of this project's firm can record an approval."}
        </p>
      ) : null}

      {mode !== "client" ? (
        <div className="mt-4 flex flex-col items-start gap-3">
          <Button kind="primary" disabled={blocked} onClick={() => post({ kind: "firm" }, `Firm approval recorded for rev ${view.to.rev}.`)} testId="approve">
            Record firm approval
          </Button>
          <Button kind="secondary" disabled={blocked} onClick={() => setMode("client")} testId="record-client">
            Record client approval
          </Button>
        </div>
      ) : (
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!clientValid || busy) return;
            post({ kind: "client", client_name: name.trim(), client_date: date, note: `${method}${ref.trim() ? ` · ref ${ref.trim()}` : ""}` }, `Client approval by ${name.trim()} on ${date} recorded for rev ${view.to.rev}.`);
          }}
          data-testid="client-approval-form"
        >
          <Field id={`${formId}-n`} label="CLIENT NAME">
            <input id={`${formId}-n`} value={name} onChange={(e) => setName(e.target.value)} required className={INPUT} autoComplete="off" />
          </Field>
          <Field id={`${formId}-d`} label="DATE GIVEN">
            <input id={`${formId}-d`} type="date" value={date} onChange={(e) => setDate(e.target.value)} required className={`${INPUT} font-bp-mono`} />
          </Field>
          <Field id={`${formId}-m`} label="HOW IT WAS GIVEN">
            <select id={`${formId}-m`} value={method} onChange={(e) => setMethod(e.target.value)} className={INPUT}>
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field id={`${formId}-r`} label="REFERENCE (OPTIONAL)">
            <input id={`${formId}-r`} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. email of 19 Sep, PO 2231" className={INPUT} autoComplete="off" />
          </Field>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button kind="primary" type="submit" disabled={!clientValid ? { reason: "Enter the client's name and the date they gave", reasonId: `${formId}-why`, showReason: false } : busy ? { reason: "Recording…", reasonId: `${formId}-why` } : false} testId="record-client-submit">
              Record client approval
            </Button>
            <Button kind="quiet" onClick={() => setMode(null)}>
              Cancel
            </Button>
          </div>
          {!clientValid ? (
            <p id={`${formId}-why`} className="t-label-md text-bp-ink-tertiary">
              Enter the client&rsquo;s name and the date they gave.
            </p>
          ) : null}
        </form>
      )}
      <div aria-live="polite" className="mt-3">
        {done ? <p className="t-body-sm text-bp-ink-primary">{done}</p> : null}
      </div>
      {error ? (
        <div role="alert" className="surface-inverse mt-3 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink">
          <p className="t-body-sm">{error}</p>
        </div>
      ) : null}
    </section>
  );
}

const INPUT =
  "h-9 w-full rounded-none border border-bp-line-control bg-bp-surface-base px-3 t-body-sm text-bp-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring";

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="t-label-caps text-bp-ink-tertiary">
        {label}
      </label>
      {children}
    </div>
  );
}

function WindowEvents({ view }: { view: RevisionsView }) {
  const reasonId = useId();
  return (
    <section aria-labelledby={`${reasonId}-h`} data-testid="window-causes">
      <h2 id={`${reasonId}-h`} className="t-label-caps text-bp-ink-tertiary">
        IN THIS WINDOW · NOT LINKED TO LINES
      </h2>
      {view.window.length === 0 ? (
        <p className="t-body-sm mt-3 text-bp-ink-secondary">Nothing else was recorded between rev {view.from.rev} and rev {view.to.rev}.</p>
      ) : (
        <>
          <p className="t-body-sm mt-3 text-bp-ink-secondary">Recorded between rev {view.from.rev} and rev {view.to.rev}, but no event names the lines it moved.</p>
          <ul className="mt-3">
            {view.window.map((w, i) => (
              <li key={i} className="grid grid-cols-[112px_minmax(0,1fr)] gap-3 border-b border-bp-line-hairline py-2.5">
                <span className="t-label-md font-bp-mono text-bp-ink-tertiary">
                  {w.time}
                  <br />
                  {w.kind.toUpperCase()}
                </span>
                <span className="t-body-sm text-bp-ink-primary">{w.summary}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="mt-4">
        <Button kind="secondary" disabled={{ reason: "Not available yet", reasonId }}>
          Link causes to lines
        </Button>
        <p id={reasonId} className="t-label-md mt-2 text-bp-ink-tertiary">
          Not available yet — linking an event to the lines it moved needs a record of its own, which is still to be built.
        </p>
      </div>
    </section>
  );
}

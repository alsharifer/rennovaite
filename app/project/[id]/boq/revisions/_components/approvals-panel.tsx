"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { approvalLabel } from "@/lib/boq/approval-label";
import type { RevisionSummary } from "@/lib/boq/revisions";
import { formatAed } from "@/lib/format/aed";

// U4 — the approval trail, and the two acts that extend it: the firm marks a
// revision approved; the firm RECORDS a client's approval with the name and
// date the client gave. Append-only — nothing here can be undone, so the form
// says so.

type Kind = "firm" | "client";
type ApiError = { error?: string; code?: string };

const day = (iso: string) => iso.slice(0, 10);
const short = (id: string) => id.slice(0, 8);

export function ApprovalsPanel({ projectId, revisions, fromId, toId, firmScoped }: { projectId: string; revisions: RevisionSummary[]; fromId: string; toId: string; firmScoped: boolean }) {
  const router = useRouter();
  const [boqId, setBoqId] = useState(toId);
  const [kind, setKind] = useState<Kind>("firm");
  const [clientName, setClientName] = useState("");
  const [clientDate, setClientDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/boq-approvals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ boq_id: boqId, kind, client_name: kind === "client" ? clientName : null, client_date: kind === "client" ? clientDate : null, note: note || null }),
      });
      const body = (await res.json().catch(() => ({}))) as ApiError;
      if (!res.ok) {
        setError(res.status === 403 ? "Only a member of this project's firm can approve its BoQ." : res.status === 401 ? "Your session has ended — sign in again." : body.error ?? `The request failed (${res.status}).`);
        return;
      }
      setDone(kind === "firm" ? `Revision ${short(boqId)} marked approved by the firm.` : `Client approval by ${clientName.trim()} on ${clientDate} recorded for revision ${short(boqId)}.`);
      setClientName("");
      setClientDate("");
      setNote("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = !busy && (kind === "firm" || (clientName.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(clientDate)));
  const shown = revisions.filter((r) => r.boq_id === fromId || r.boq_id === toId || r.approvals.trail.length > 0).slice(0, 8);

  return (
    <section className="mt-xl rounded-xl border border-ink-100 bg-paper p-lg" aria-label="Approvals" data-testid="approvals-panel">
      <p className="label-caps text-ink-500">Approval trail</p>
      <h2 className="mt-xs font-display text-headline-md text-ink-900">Who approved which revision</h2>
      <p className="mt-sm max-w-2xl text-body-sm text-ink-700">
        {firmScoped ? "A member of this project's firm marks a revision approved. " : "A signed-in account marks a revision approved. "}A client&apos;s approval is recorded by the firm as an event, with the name and date the
        client gave. Every entry stays: the trail is append-only.
      </p>

      <ul className="mt-md divide-y divide-ink-100" data-testid="approval-trail">
        {shown.map((r) => (
          <li key={r.boq_id} className="flex flex-wrap items-baseline justify-between gap-sm py-sm">
            <div>
              <span className="font-mono text-body-sm text-ink-900">{short(r.boq_id)}</span>
              <span className="ml-sm text-body-sm text-ink-500">
                {day(r.created_at)} · {formatAed(r.grand_total_aed, "amount")}
                {r.draft ? " · draft" : ""}
              </span>
            </div>
            <div className="text-right text-body-sm text-ink-700">
              {r.approvals.trail.length === 0 ? (
                <span className="text-ink-500">not approved</span>
              ) : (
                r.approvals.trail.map((a) => (
                  <div key={a.id} data-approval-kind={a.kind}>
                    {approvalLabel(a)}
                    {a.note ? <span className="text-ink-500"> — {a.note}</span> : null}
                  </div>
                ))
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-lg grid grid-cols-1 gap-sm md:grid-cols-6">
        <label className="md:col-span-2">
          <span className="label-caps text-ink-500">Revision</span>
          <select value={boqId} onChange={(e) => setBoqId(e.target.value)} aria-label="Revision to approve" className="focus-ring mt-xs w-full rounded border border-ink-100 bg-paper px-sm py-xs font-mono text-body-sm text-ink-900">
            {revisions.map((r) => (
              <option key={r.boq_id} value={r.boq_id}>
                {day(r.created_at)} · {short(r.boq_id)} · {formatAed(r.grand_total_aed, "amount")}
              </option>
            ))}
          </select>
        </label>
        <label className="md:col-span-1">
          <span className="label-caps text-ink-500">Act</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label="Kind of approval" className="focus-ring mt-xs w-full rounded border border-ink-100 bg-paper px-sm py-xs text-body-sm text-ink-900">
            <option value="firm">Firm approves</option>
            <option value="client">Record client approval</option>
          </select>
        </label>
        {kind === "client" && (
          <>
            <label className="md:col-span-2">
              <span className="label-caps text-ink-500">Client name</span>
              <input value={clientName} onChange={(e) => setClientName(e.target.value)} aria-label="Client name" className="focus-ring mt-xs w-full rounded border border-ink-100 bg-paper px-sm py-xs text-body-sm text-ink-900" />
            </label>
            <label className="md:col-span-1">
              <span className="label-caps text-ink-500">Date given</span>
              <input type="date" value={clientDate} onChange={(e) => setClientDate(e.target.value)} aria-label="Client approval date" className="focus-ring mt-xs w-full rounded border border-ink-100 bg-paper px-sm py-xs font-mono text-body-sm text-ink-900" />
            </label>
          </>
        )}
        <label className={kind === "client" ? "md:col-span-6" : "md:col-span-3"}>
          <span className="label-caps text-ink-500">Note (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} aria-label="Approval note" className="focus-ring mt-xs w-full rounded border border-ink-100 bg-paper px-sm py-xs text-body-sm text-ink-900" />
        </label>
      </div>
      <div className="mt-md flex flex-wrap items-center gap-md">
        <button type="button" onClick={submit} disabled={!canSubmit} className="focus-ring inline-flex h-10 items-center gap-xs rounded-lg bg-brass-600 px-md font-body text-body-sm font-semibold text-white disabled:opacity-50" data-testid="approve">
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            {kind === "firm" ? "verified" : "how_to_reg"}
          </span>
          {kind === "firm" ? "Mark approved by the firm" : "Record the client's approval"}
        </button>
        {error && (
          <p role="alert" className="text-body-sm text-error">
            {error}
          </p>
        )}
        {done && <p className="text-body-sm text-ink-700">{done}</p>}
      </div>
    </section>
  );
}

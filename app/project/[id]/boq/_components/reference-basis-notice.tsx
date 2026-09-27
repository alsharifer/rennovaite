"use client";

import { useState } from "react";

import { REFERENCE_BASIS_BANNER, type ProposalGateVerdict, type ReferenceBasis, type ReferenceBasisAcceptance } from "@/lib/documents/reference-basis-types";

// L4 — the reference-basis banner. Shown on any BoQ with a line resolved below
// the firm's own book. When the project has a firm, a member can ACCEPT that
// basis for this revision — recorded as an event — which is what lets a client
// proposal export; a reviewed rate book passes without it.

type ApiError = { error?: string; code?: string };

export function ReferenceBasisNotice({
  projectId,
  boqId,
  basis,
  firm,
  acceptance,
  verdict,
}: {
  projectId: string;
  boqId: string;
  basis: ReferenceBasis;
  firm: { brand: string; book_status: "draft" | "reviewed" | null } | null;
  acceptance: ReferenceBasisAcceptance | null;
  verdict: ProposalGateVerdict;
}) {
  const [accepted, setAccepted] = useState<ReferenceBasisAcceptance | null>(acceptance);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (basis.reference_lines === 0) return null;

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/reference-basis`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ boq_id: boqId, note: note.trim() || null }),
      });
      const body = (await res.json().catch(() => ({}))) as ApiError & { acceptance?: ReferenceBasisAcceptance };
      if (!res.ok || !body.acceptance) {
        setError(res.status === 403 ? "Only a member of this project's firm can accept its pricing basis." : res.status === 401 ? "Sign in to accept the pricing basis." : body.error ?? `The request failed (${res.status}).`);
        return;
      }
      setAccepted(body.acceptance);
    } finally {
      setBusy(false);
    }
  };

  const passes = verdict.ok || !!accepted;
  return (
    <div id="reference-basis" className="mb-md max-w-[900px] rounded-md border border-[#E8C9A0] bg-[#FEF6EC] px-md py-sm" data-reference-basis={basis.basis} data-reference-lines={basis.reference_lines}>
      <p className="font-body text-body-sm font-semibold uppercase tracking-wide text-[#A4793A]">{REFERENCE_BASIS_BANNER}</p>
      <p className="mt-1 font-body text-[13px] text-ink-700">
        {basis.reference_lines} of {basis.total_lines} lines are priced from the market reference
        {basis.firm_lines > 0 ? `; ${basis.firm_lines} from the firm's own book` : ""}
        {basis.unpriced_lines > 0 ? `; ${basis.unpriced_lines} still to be priced` : ""}.
      </p>
      {firm ? (
        firm.book_status === "reviewed" ? (
          <p className="mt-1 font-body text-[13px] text-ink-700" data-basis-status="book_reviewed">
            {firm.brand}&rsquo;s rate book is marked reviewed — a client proposal on this basis can be exported.
          </p>
        ) : accepted ? (
          <p className="mt-1 font-body text-[13px] text-ink-700" data-basis-status="accepted">
            Reference basis accepted by the firm for this BoQ revision on {accepted.created_at.slice(0, 10)}
            {accepted.note ? ` — ${accepted.note}` : ""}. A client proposal can be exported.
          </p>
        ) : (
          <div className="mt-sm flex flex-wrap items-center gap-sm" data-basis-status="open">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note for the record (optional)"
              aria-label="Acceptance note"
              className="focus-ring h-9 min-w-[260px] flex-1 rounded border border-ink-100 bg-paper px-sm font-body text-body-sm text-ink-900"
            />
            <button type="button" onClick={accept} disabled={busy} className="focus-ring inline-flex h-9 items-center gap-xs rounded-lg bg-brass-600 px-md font-body text-body-sm font-semibold text-white disabled:opacity-50" data-testid="accept-reference-basis">
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                fact_check
              </span>
              Accept the reference basis for this revision
            </button>
            <span className="font-body text-[12px] text-ink-500">Or mark {firm.brand}&rsquo;s rate book reviewed. Either way the choice is recorded; a client proposal exports only after one of them.</span>
          </div>
        )
      ) : (
        <p className="mt-1 font-body text-[13px] text-ink-500">A client proposal needs a firm on this project; the firm then accepts the basis or reviews its book.</p>
      )}
      {error && (
        <p role="alert" className="mt-xs font-body text-[13px] text-error">
          {error}
        </p>
      )}
      {!passes && firm && <span className="sr-only">proposal export blocked</span>}
    </div>
  );
}

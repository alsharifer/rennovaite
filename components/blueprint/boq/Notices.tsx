"use client";

// =============================================================================
// components/blueprint/boq/Notices.tsx — the notice rows under the pinned total
// (R7 §3.2, 13:48): each ONE line — flag icon · label/caps key · sentence ·
// one Quiet action. DRAFT FOR REVIEW (the garden draft statement) and PRICED
// FROM MARKET REFERENCE (the L4 reference basis) are the frame's two; the
// duplicate-component finding, existing-on-site decisions and permit triggers
// use the same row when they apply. Only the Quiet action is a tab stop (§4.3).
//
// The reference-basis row keeps L4's accept control: a member of the project's
// firm accepts the market basis for THIS revision (recorded), which is what
// lets a client proposal export — a stated choice, never a silent default.
// =============================================================================

import { useId, useState, type ReactNode } from "react";

import type { ReviewModel } from "@/lib/boq/review-types";

import { Button } from "../Button";
import { Icon } from "../Icon";

function Row({ k, children, action, data }: { k: string; children: ReactNode; action?: ReactNode; data?: Record<string, string> }) {
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-2 border-b border-bp-line-hairline py-4" {...data}>
      <p className="t-label-caps flex w-full shrink-0 items-center gap-3 text-bp-ink-primary sm:w-[260px]">
        <Icon name="flag" size={18} className="text-bp-ink-secondary" />
        {k}
      </p>
      <div className="t-body-sm min-w-0 flex-1 text-bp-ink-secondary">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Notices({ model, permits }: { model: ReviewModel; permits: { title: string; consequence: string }[] | null }) {
  const n = model.notices;
  const id = model.projectId;
  return (
    <div className="px-6 md:px-8">
      {n.draft ? (
        <Row k={n.draft.key} data={{ "data-boq-draft": "true" }} action={<Button kind="quiet" href={`/project/${id}/plan`}>Site measurements</Button>}>
          {n.draft.sentence} {n.draft.derivedLines > 0 ? `${n.draft.derivedLines} lines carry derived quantities.` : ""}
          {n.draft.note ? <span className="block text-bp-ink-tertiary">Source: {n.draft.note}</span> : null}
        </Row>
      ) : null}
      {n.reference ? <ReferenceRow model={model} /> : null}
      {n.duplicates.length > 0 ? (
        <Row k={n.duplicates.length === 1 ? "Priced twice" : `${n.duplicates.length} components priced twice`} data={{ "data-duplicates": String(n.duplicates.length) }}>
          <details>
            <summary className="cursor-pointer">Charged by two mechanisms — nothing removed automatically; which line survives is a QS scope ruling.</summary>
            <ul className="mt-2 space-y-1">
              {n.duplicates.map((d) => (
                <li key={d.label + d.detail}>
                  <span className="text-bp-ink-primary">{d.label}</span> — {d.detail}
                </li>
              ))}
            </ul>
          </details>
        </Row>
      ) : null}
      {n.garden ? (
        <Row
          k="Existing on site"
          action={n.garden.undecided > 0 ? <Button kind="quiet" href={`/project/${id}/plan`}>Decide on the plan</Button> : undefined}
          data={{ "data-existing-on-site": "true" }}
        >
          Kept and excluded: {n.garden.kept} · removed or replaced (in demolition): {n.garden.removed}
          {n.garden.undecided > 0 ? ` · ${n.garden.undecided} undecided — in no quantity until decided` : ""}
        </Row>
      ) : null}
      {permits && permits.length > 0 ? (
        <Row k="Permits & approvals" data={{ "data-permits": String(permits.length) }}>
          <details>
            <summary className="cursor-pointer">
              {permits.length} trigger{permits.length === 1 ? "" : "s"} on this plan — guidance, not legal advice; your consultant confirms before contract.
            </summary>
            <ul className="mt-2 space-y-1">
              {permits.map((p) => (
                <li key={p.title}>
                  <span className="text-bp-ink-primary">{p.title}</span> — {p.consequence}
                </li>
              ))}
            </ul>
          </details>
        </Row>
      ) : null}
    </div>
  );
}

function ReferenceRow({ model }: { model: ReviewModel }) {
  const r = model.notices.reference!;
  const [status, setStatus] = useState(r.status);
  const [acceptedOn, setAcceptedOn] = useState(r.acceptedOn);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${model.projectId}/reference-basis`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ boq_id: model.boqId, note: note.trim() || null }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; acceptance?: { created_at: string } };
      if (!res.ok || !body.acceptance) {
        setError(res.status === 403 ? "Only a member of this project's firm can accept its pricing basis." : (body.error ?? `The request failed (${res.status}).`));
        return;
      }
      setStatus("accepted");
      setAcceptedOn(body.acceptance.created_at.slice(0, 10));
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  const sentence = `${r.referenceLines} of ${r.totalLines} lines${r.firmLines > 0 ? ` (${r.firmLines} from your book)` : ""}.`;
  const tail =
    status === "book_reviewed"
      ? " Your rate book is marked reviewed — a client proposal on this basis can be exported."
      : status === "accepted"
        ? ` Market basis accepted for this revision on ${acceptedOn}${r.acceptedNote ? ` — ${r.acceptedNote}` : ""}. A client proposal can be exported.`
        : status === "no_firm"
          ? " A client proposal needs a firm on this project; the firm then reviews its book or accepts the market basis."
          : " Review your rate book or accept the market basis before any client document.";

  return (
    <div data-reference-basis="reference" data-basis-status={status} data-reference-lines={r.referenceLines} id="reference-basis">
      <Row
        k={r.key}
        action={
          status === "open" ? (
            <span className="inline-flex flex-wrap items-center gap-6">
              <Button kind="quiet" onClick={() => setOpen((o) => !o)}>
                Accept market basis
              </Button>
              <Button kind="quiet" href={`/project/${model.projectId}/rates`}>
                Review rates
              </Button>
            </span>
          ) : status === "no_firm" ? undefined : (
            <Button kind="quiet" href={`/project/${model.projectId}/rates`}>
              Review rates
            </Button>
          )
        }
      >
        {sentence}
        {tail}
        {open ? (
          <span className="mt-3 flex flex-wrap items-center gap-3">
            <label htmlFor={noteId} className="sr-only">
              Note for the record
            </label>
            <input
              id={noteId}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note for the record (optional)"
              className="t-body-sm h-9 min-w-[260px] flex-1 rounded-none border border-bp-line-control bg-bp-surface-base px-3 text-bp-ink-primary"
            />
            <span data-testid="accept-reference-basis">
              <Button kind="secondary" onClick={busy ? undefined : accept}>
                {busy ? "Recording…" : "Accept for this revision"}
              </Button>
            </span>
          </span>
        ) : null}
        {error ? (
          <span role="alert" className="mt-2 block text-bp-ink-primary">
            {error}
          </span>
        ) : null}
      </Row>
    </div>
  );
}

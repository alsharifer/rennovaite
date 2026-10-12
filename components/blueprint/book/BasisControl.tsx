"use client";

// =============================================================================
// components/blueprint/book/BasisControl.tsx — the REFERENCE BASIS column of
// the Rates & Basis status strip, in a project's context (R7 §3.3).
//
// "Accept market basis for this project" records the L4 acceptance for the
// project's CURRENT revision (POST /api/projects/:id/reference-basis), with
// the member's name on the record. Kept out of the book editor: that file may
// only talk to this firm's own routes (page-privacy test).
// =============================================================================

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "../Button";

export function BasisControl({ projectId, boqId, rev, status, acceptedOn }: { projectId: string; boqId: string | null; rev: number; status: "open" | "accepted" | "book_reviewed" | "no_boq"; acceptedOn: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    if (!boqId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/reference-basis`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ boq_id: boqId, note: null }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(res.status === 403 ? "Only a member of this project's firm can accept its pricing basis." : (body.error ?? `The request failed (${res.status}).`));
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (status === "no_boq") return <p className="t-body-sm mt-2 text-bp-ink-secondary">No BoQ yet — nothing to accept.</p>;
  if (status === "book_reviewed")
    return (
      <>
        <p className="t-heading-sm mt-2" data-basis-status="book_reviewed">
          Book reviewed
        </p>
        <p className="t-body-sm mt-1 text-bp-ink-secondary">Every line this book does not price may use the market reference on the client proposal.</p>
      </>
    );
  if (status === "accepted")
    return (
      <>
        <p className="t-heading-sm mt-2" data-basis-status="accepted">
          Accepted for rev {rev}
        </p>
        <p className="t-body-sm mt-1 text-bp-ink-secondary">Recorded {acceptedOn}. A changed revision needs a new acceptance.</p>
      </>
    );
  return (
    <>
      <p className="t-heading-sm mt-2" data-basis-status="open">
        Not accepted
      </p>
      <p className="t-body-sm mt-1 text-bp-ink-secondary">The client proposal stays locked until the book is reviewed or you accept the market basis.</p>
      <div className="mt-3">
        <Button kind="quiet" onClick={busy ? undefined : accept} testId="accept-reference-basis">
          {busy ? "Recording…" : "Accept market basis for this project"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="t-body-sm mt-2">
          {error}
        </p>
      ) : null}
    </>
  );
}
